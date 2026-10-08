'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../lib/export-provenance.js');
const { applyFinancialCases, table: financialTable } = require('../lib/financial-known-cases.js');
const { applyKnownCases } = require('../lib/yahoo-q4-known-cases.js');
const { applyShareCountTable, loadShareCountTable, applyAdsHandTable, loadAdsHandTable } = require('../lib/ads-hand-table.js');
const { preserveReloadHistory } = require('../lib/reload-history.js');
const { statementFactor, loadStatementCurrencyTable } = require('../lib/statement-currency-hand-table.js');
const { compareExports, jsonFiles } = require('../scripts/check-export-additive.js');
const { fixtureSnapshot } = require('../scripts/period-labels-check.js');
const crdo = require('./fixtures/period-labels/period-fixtures.json').cases.find(c => c.ticker === 'CRDO');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-provenance-test-'));
const clone = value => JSON.parse(JSON.stringify(value));
let ok = 0, fail = 0;
function test(name, fn) {
  try { fn(); ok++; console.log('PASS ' + name); }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + e.stack); }
}
function snapshot() {
  return { meta: { ticker: 'TEST', reportingCurrency: 'USD', tradingCurrency: 'USD', fetchedAt: '2026-10-03T08:00:00Z' },
    marketCap: { value: 0, source: 'yahoo_quote' }, annual: { annualRev: [120, 100], annualRevEnds: ['2025-12-31', '2024-12-31'] },
    timeseries: { revenueQ: [120, 110, 105, 102, 100].map(value => ({ value })),
      revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } };
}
function rowFor(s, rounding) {
  const c = p.captureSnapshot(s), leg = c.leg;
  return { ticker: s.meta.ticker, marketCap: s.marketCap.value,
    revGrowthYoYPct: rounding ? Math.round(leg.pct * 10) / 10 : leg.pct,
    revGrowthBasis: leg.basis, revGrowthPeriodEnd: leg.periodEnd, revGrowthPriorPeriodEnd: leg.priorPeriodEnd };
}
function completeSources(s) {
  const c = p.captureSnapshot(s);
  for (const r of [...c.inputs, c.marketCap]) Object.assign(r, { documentUrl: 'https://example.invalid/filing', page: 1, quote: 'Synthetic source fixture.' });
  return c;
}
function fixture(s = snapshot(), reviews = [], rounding, sources = false) {
  const row = rowFor(s, rounding), file = { schema: 'findash-export/v1', rows: [row] };
  const manifest = p.buildProvenance([file], { runId: 'test-run', generatedAt: '2026-10-03T09:31:00Z',
    creator: { engine: 'fixture', model: null, sessionId: 'creator-session' }, reviews, rounding,
    snapshotFor: () => sources ? completeSources(s) : p.captureSnapshot(s) });
  return { file, manifest, row };
}
function rehash(f) { f.file.provenanceManifestSha256 = p.sha256(JSON.stringify(f.manifest, null, 2)); }
function reviewFor(record, id, session = 'separate-review-session') {
  return { id, evidenceIds: [record.id], scopeId: p.SCOPE, valueHash: record.valueHash,
    methodVersion: record.derivation.methodVersion, reviewerEngine: 'fixture', reviewerModel: null,
    reviewerSessionId: session, checkedAt: '2026-10-03T09:30:00Z', result: 'reproduced',
    reason: 'Synthetic test fixture.', sourceReopenedAt: '2026-10-03T09:29:00Z', supersedesReviewId: null };
}

test('exact keys, two operand paths/periods, hashes and honest unknown times', () => {
  const f = fixture();
  assert.equal(p.validateProvenance([f.file], f.manifest), true);
  for (const r of f.manifest.records) {
    assert.deepEqual(Object.keys(r).sort(), [...p.RECORD_FIELDS].sort());
    assert.deepEqual(Object.keys(r.fx).sort(), [...p.FX_FIELDS].sort());
    assert.deepEqual(Object.keys(r.derivation).sort(), [...p.DERIVATION_FIELDS].sort());
    assert.equal(r.valueHash, p.sha256(JSON.stringify(r.normalizedValue)));
    assert.equal(r.retrievedAt, null); // Snapshot-wide time proves none of these unstamped sources.
    assert.equal(r.publishedAt, null);
  }
  const growth = f.manifest.records.find(r => r.fieldPath === 'revGrowthYoYPct');
  assert.equal(growth.derivation.inputIds.length, 2);
  assert.equal(growth.periodEnd, f.row.revGrowthPeriodEnd);
  assert.equal(growth.comparativeBasis, f.row.revGrowthPriorPeriodEnd);
  const inputs = growth.derivation.inputIds.map(id => f.manifest.records.find(r => r.id === id));
  assert.equal((inputs[0].normalizedValue / inputs[1].normalizedValue - 1) * 100, f.row.revGrowthYoYPct);
  assert.equal(f.row.fieldStatus.marketCap.presence, 'present'); // real zero
  const s = snapshot(); delete s.meta.fetchedAt;
  assert(fixture(s).manifest.records.every(r => r.retrievedAt === null));
});

test('P134: relabelled CRDO operands keep source-period stamps and display periods', () => {
  const s = fixtureSnapshot(crdo), fetchedAt = '2026-08-08T04:11:22.446Z';
  s.meta.statementPeriods = { revenueQ: crdo.rows.map(r => ({ end: r.vendorEnd, fetchedAt })) };
  const prepared = applyFinancialCases(s).snapshot, before = JSON.stringify(prepared);
  const captured = p.captureSnapshot(prepared);
  assert.deepEqual(captured.inputs.map(r => r.retrievedAt), [fetchedAt, fetchedAt]);
  assert.deepEqual(captured.inputs.map(r => r.periodEnd), ['2026-05-02', '2025-05-03']);
  assert.deepEqual([captured.leg.sourcePeriodEnd, captured.leg.sourcePriorPeriodEnd], ['2026-04-30', '2025-04-30']);
  const file = { rows: [rowFor({ ...prepared, marketCap: { value: null } })] };
  const manifest = p.buildProvenance([file], { snapshotFor: () => captured });
  const growth = manifest.records.find(r => r.fieldPath === 'revGrowthYoYPct');
  assert.equal(growth.periodEnd, file.rows[0].revGrowthPeriodEnd);
  assert.equal(growth.comparativeBasis, file.rows[0].revGrowthPriorPeriodEnd);
  assert.equal(JSON.stringify(prepared), before);
});

test('P134: retained CRDO stamps match source periods', () => {
  const s = fixtureSnapshot(crdo), fetchedAt = '2026-08-08T04:11:22.446Z';
  s.meta.reloadHistoryRetained = crdo.rows.map(r => ({ field: 'revenueQ', end: r.vendorEnd, fetchedAt }));
  const inputs = p.captureSnapshot(applyFinancialCases(s).snapshot).inputs;
  assert.deepEqual(inputs.map(r => r.retrievedAt), [fetchedAt, fetchedAt]);
  assert.deepEqual(inputs.map(r => r.periodEnd), ['2026-05-02', '2025-05-03']);
});

test('P134: display-only CRDO stamps prove neither revenue operand', () => {
  for (const retained of [false, true]) {
    const s = fixtureSnapshot(crdo), fetchedAt = '2026-08-08T04:11:22.446Z';
    const stamps = crdo.rows.map(r => ({ field: 'revenueQ', end: r.reportedEnd, fetchedAt }));
    if (retained) s.meta.reloadHistoryRetained = stamps;
    else s.meta.statementPeriods = { revenueQ: stamps };
    const inputs = p.captureSnapshot(applyFinancialCases(s).snapshot).inputs;
    assert.deepEqual(inputs.map(r => r.retrievedAt), [null, null]);
    assert.deepEqual(inputs.map(r => r.periodEnd), ['2026-05-02', '2025-05-03']);
  }
});

test('no reviews means zero verified, requiredFields follow present keys, null stays missing', () => {
  const f = fixture();
  assert.deepEqual(f.manifest.reviews, []);
  assert.equal(f.row.verification.status, 'unchecked');
  assert.equal(f.file.verificationSummary.fullyVerifiedRows, 0);
  assert.equal(f.file.verificationSummary.uncheckedRows, 1);
  assert.equal(f.row.verification.checkedAt, null);
  assert.equal(f.row.verification.reason, p.REASON);
  const file = { rows: [{ ticker: 'TEST', marketCap: null }] };
  p.buildProvenance([file]);
  assert.deepEqual(file.rows[0].verification.requiredFields, ['marketCap']);
  assert.equal(file.rows[0].fieldStatus.marketCap.presence, 'missing');
});

test('independent reviews verify; creator session, stale hash and wrong scope do not', () => {
  const original = fixture(snapshot(), [], undefined, true);
  const roots = original.manifest.records.filter(r => p.FIELDS.includes(r.fieldPath));
  const same = roots.map((r, i) => reviewFor(r, 'same-' + i, 'creator-session'));
  assert.equal(fixture(snapshot(), same, undefined, true).row.verification.status, 'unchecked');
  const other = roots.map((r, i) => reviewFor(r, 'other-' + i));
  const verified = fixture(snapshot(), other, undefined, true);
  assert.equal(verified.row.verification.status, 'verified');
  assert.equal(verified.file.verificationSummary.fullyVerifiedRows, 1);
  assert.deepEqual(Object.keys(other[0]).sort(), [...p.REVIEW_FIELDS].sort());
  assert.equal(fixture(snapshot(), [other[0]], undefined, true).row.verification.status, 'partial');
  assert.equal(fixture(snapshot(), other.map(r => ({ ...r, valueHash: '0'.repeat(64) })), undefined, true).row.verification.status, 'unchecked');
  assert.equal(fixture(snapshot(), other.map(r => ({ ...r, scopeId: 'another-scope' })), undefined, true).row.verification.status, 'unchecked');
  const forgery = fixture(); forgery.row.fieldStatus.marketCap.verification = 'matched';
  assert.throws(() => p.validateProvenance([forgery.file], forgery.manifest), /independent review/);
  // Every ancestor creator counts, not just the field's top-level creator.
  const dep = verified.manifest.records.find(r => r.fieldPath.startsWith('timeseries.'));
  dep.creatorSessionId = 'separate-review-session'; rehash(verified);
  assert.throws(() => p.validateProvenance([verified.file], verified.manifest), /independent review/);
});

test('applied financial case is traced; equal vendor values and unrelated operands are not corrections', () => {
  const cases = financialTable.cases.filter(c => c.ticker === 'HTGC' && c.field === 'revenueQ').sort((a, b) => b.period.localeCompare(a.period));
  assert(cases.length >= 5);
  const s = snapshot(); s.meta.ticker = 'HTGC';
  s.timeseries = { revenueQ: cases.map(c => ({ value: c.expectedBadValue })), revenueQEnds: cases.map(c => c.period) };
  const applied = applyFinancialCases(s);
  assert(applied.events.some(e => e.status === 'corrected'));
  const f = fixture(applied.snapshot);
  const records = f.manifest.records.filter(r => r.sourceType === 'handTable');
  assert.equal(records.length, 2);
  assert(records.every(r => r.correctionCaseId && r.documentUrl && r.page && r.quote));
  const equal = clone(s); equal.timeseries.revenueQ = cases.map(c => ({ value: c.replacementValue }));
  assert.equal(fixture(applyFinancialCases(equal).snapshot).manifest.records.filter(r => r.sourceType === 'handTable').length, 0);
  // A real applied correction at an intervening quarter does not supply either growth operand.
  const intervening = clone(equal);
  intervening.timeseries.revenueQ[1] = clone(applied.snapshot.timeseries.revenueQ[1]);
  assert.equal(fixture(intervening).manifest.records.filter(r => r.sourceType === 'handTable').length, 0);
});

const p154Case = (ticker, period) => financialTable.cases.find(c => c.ticker === ticker && c.field === 'revenueQ' && c.period === period);
function p154Fixture(c) {
  const s = snapshot(), prior = new Date(c.period);
  prior.setUTCFullYear(prior.getUTCFullYear() - 1);
  Object.assign(s.meta, { ticker: c.ticker, reportingCurrency: c.currency, tradingCurrency: c.currency });
  // Exercise an existing persisted marker; equal confirmed cells deliberately acquire no new marker.
  s.timeseries = { revenueQ: [{ value: c.replacementValue, financialCorrection: {
    caseId: c.caseId, replacementNativeValue: c.replacementValue, nativeCurrency: c.currency, revision: financialTable.revision,
  } }, s.timeseries.revenueQ[4]], revenueQEnds: [c.period, prior.toISOString().slice(0, 10)] };
  return fixture(s);
}

test('p154: ARCC fourth quarter exports the two original source operands in native USD', () => {
  const c = p154Case('ARCC', '2025-12-31'), f = p154Fixture(c);
  const r = f.manifest.records.find(r => r.correctionCaseId === c.caseId), d = r.handTableDerivation;
  assert.equal(d.formulaDe, 'Viertes Quartal = Geschäftsjahr minus neun Monate');
  assert.deepEqual(d.inputs.map(i => i.value), [3052000000, 2259000000]);
  assert.deepEqual(d.inputs.map(i => i.currency), ['USD', 'USD']);
  assert.deepEqual(d.inputs.map(i => i.labelDe), ['Geschäftsjahr (01.01.2025 bis 31.12.2025)', 'neun Monate (01.01.2025 bis 30.09.2025)']);
  d.inputs.forEach((input, i) => {
    for (const key of ['quote', 'url', 'page', 'form', 'filed']) assert.equal(input[key], c.sources[i][key] ?? null, key);
  });
  assert.equal(d.inputs[0].value - d.inputs[1].value, r.nativeValue);
  assert.equal(r.quote, c.sources[0].quote); assert.equal(r.documentUrl, c.sources[0].url);
  assert.equal(r.page, c.sources[0].page); assert.equal(r.documentTitle, c.sources[0].title || c.sources[0].form || null);
  assert.equal(r.derivation.inputIds.length, 0); assert.equal(f.manifest.records.length, 4);
  assert.equal(f.row.verification.status, 'unchecked');
  const wire = JSON.parse(p.serializeManifest(f.manifest));
  assert.deepEqual(wire.records.map(p.expandRecord), f.manifest.records);
});

test('p154: 000688 direct Q2 quote comes first and the later derived Q2 names both periods', () => {
  const c = p154Case('000688.SZ', '2025-06-30');
  const raw = require('./fixtures/financial-known-cases.json').snapshots[c.ticker];
  const prepared = applyFinancialCases(raw).snapshot;
  const r = fixture({ ...prepared, marketCap: { value: 0 } }).manifest.records.find(r => r.correctionCaseId === c.caseId);
  assert.ok(r); assert.match(r.quote, /1,073,278,451\.44/); assert.ok(!r.quote.includes('2,159,670,362.38'));
  assert.equal(r.nativeValue, 1073278451.44); assert.equal(r.handTableDerivation, null);
  const later = p154Case('000688.SZ', '2026-06-30');
  const derived = p154Fixture(later).manifest.records.find(r => r.correctionCaseId === later.caseId);
  assert.equal(derived.handTableDerivation.formulaDe, 'Zweites Quartal = Halbjahr minus erstes Quartal');
  assert.equal(derived.handTableDerivation.inputs[0].value - derived.handTableDerivation.inputs[1].value, later.replacementValue);
  const japanese = p154Case('8020.T', '2025-12-31');
  const japaneseRecord = p154Fixture(japanese).manifest.records.find(r => r.correctionCaseId === japanese.caseId);
  assert.equal(japaneseRecord.handTableDerivation.formulaDe, 'Drittes Quartal = neun Monate minus Halbjahr');
});

test('p154: single source has logical null and no handTableDerivation key on the wire', () => {
  const c = p154Case('ARCC', '2026-06-30'), f = p154Fixture(c);
  const r = f.manifest.records.find(r => r.correctionCaseId === c.caseId);
  assert.equal(r.handTableDerivation, null);
  const wire = JSON.parse(p.serializeManifest(f.manifest)).records.find(r => r.correctionCaseId === c.caseId);
  assert.equal(Object.hasOwn(wire, 'handTableDerivation'), false);
  const expanded = p.expandRecord(wire);
  assert.equal(Object.hasOwn(expanded, 'handTableDerivation'), true); assert.equal(expanded.handTableDerivation, null);
});

test('p154: issuer-rounded OXLC exports its original rounded source without an invented filed date', () => {
  const c = p154Case('OXLC', '2025-03-31'), f = p154Fixture(c);
  const r = f.manifest.records.find(r => r.correctionCaseId === c.caseId), d = r.handTableDerivation;
  assert.equal(d.formulaDe, 'Die Firma nennt den Wert nur gerundet (auf 100.000 USD); der angezeigte Wert liegt innerhalb dieser Rundung.');
  assert.equal(d.inputs.length, 1); assert.equal(d.inputs[0].value, 121200000);
  assert.equal(d.inputs[0].labelDe, 'Quartal (01.01.2025 bis 31.03.2025)');
  for (const key of ['quote', 'url', 'page', 'form', 'filed']) assert.equal(d.inputs[0][key], c.sources[0][key] ?? null, key);
  assert.equal(d.inputs[0].filed, null); assert.equal(r.nativeValue, 121161000);
});

test('p154: every real single-source revenue case leads with its matching source, with an isolated red proof', () => {
  const before = p.sha256(fs.readFileSync(path.join(__dirname, '../configs/financial-known-cases.json')));
  const guard = table => {
    for (const c of table.cases.filter(c => ['revenueQ', 'annualRev'].includes(c.field) &&
      Number.isFinite(c.replacementValue) && c.sources.some(s => Number.isFinite(s.value) && s.value === c.replacementValue))) {
      assert.equal(c.sources[0].value, c.replacementValue, c.caseId);
      assert.equal(p.handTableDerivation(c), null, c.caseId);
    }
  };
  guard(financialTable);
  const broken = clone(financialTable), c = broken.cases.find(c => c.caseId === '000688.sz-2025-06-30-revenueQ-p138');
  c.sources = [c.sources[1], c.sources[2], c.sources[0]];
  assert.throws(() => guard(broken), e => e instanceof assert.AssertionError && e.message.includes(c.caseId));
  assert.equal(p.sha256(fs.readFileSync(path.join(__dirname, '../configs/financial-known-cases.json'))), before);
  console.log('RED p154: original 000688 source order rejected on a copy; live SHA256 unchanged');
});

test('p154: all real derived revenue cases export original inputs and reproduce every difference', () => {
  // Measurement command: node -e "const fs=require('node:fs'),vm=require('node:vm'),t=require('./configs/financial-known-cases.json');const k=vm.runInNewContext(fs.readFileSync('tests/financial-known-cases.test.js','utf8').match(/^const traceKind = c => \{[\s\S]*?^\};/m)[0]+';traceKind');for(const revenue of [true,false])console.log(revenue,t.cases.filter(c=>['revenueQ','annualRev'].includes(c.field)===revenue&&['difference','rounded'].includes(k(c))).length);"
  const definition = fs.readFileSync(path.join(__dirname, 'financial-known-cases.test.js'), 'utf8').match(/^const traceKind = c => \{[\s\S]*?^\};/m);
  assert.ok(definition);
  const traceKind = require('node:vm').runInNewContext(definition[0] + ';traceKind');
  const cases = financialTable.cases.filter(c => ['revenueQ', 'annualRev'].includes(c.field) && ['difference', 'rounded'].includes(traceKind(c)));
  assert.equal(cases.length, 20); // 19 differences and 1 issuer-rounded case; other fields have 5 differences.
  for (const c of financialTable.cases.filter(c => ['revenueQ', 'annualRev'].includes(c.field))) {
    const d = p.handTableDerivation(c), kind = traceKind(c);
    if (!cases.includes(c)) { assert.equal(d, null, c.caseId); continue; }
    assert.ok(d, c.caseId); assert.deepEqual(Object.keys(d).sort(), ['formulaDe', 'inputs']);
    assert.ok(!/[\u2010-\u2015\u2212]|\s-\s/.test(d.formulaDe), c.caseId);
    assert.equal(d.inputs.length, kind === 'difference' ? 2 : 1, c.caseId);
    for (const input of d.inputs) {
      assert.deepEqual(Object.keys(input).sort(), ['currency', 'filed', 'form', 'labelDe', 'page', 'quote', 'url', 'value']);
      assert.ok(!/[\u2010-\u2015\u2212]|\s-\s/.test(input.labelDe), c.caseId);
      assert.equal(input.currency, c.currency);
      assert.ok(c.sources.some(s => s.value === input.value && ['quote', 'url', 'page', 'form', 'filed'].every(key => (s[key] ?? null) === input[key])), c.caseId);
    }
    if (kind === 'difference') assert.equal(d.inputs[0].value - d.inputs[1].value, c.replacementValue, c.caseId);
  }
});

test('p154: derivation contract and validation reject malformed copies before any identity checks', () => {
  const f = p154Fixture(p154Case('ARCC', '2025-12-31'));
  assert.equal(p.validateProvenance([f.file], f.manifest), true);
  const contract = require('../docs/findash-export-v1.contract.json').provenanceContract;
  assert.deepEqual(contract.recordFields, p.RECORD_FIELDS);
  assert.deepEqual(contract.handTableDerivationFields, ['formulaDe', 'inputs']);
  assert.deepEqual(contract.handTableDerivationInputFields, ['labelDe', 'value', 'currency', 'quote', 'url', 'page', 'form', 'filed']);
  for (const [name, mutate, diagnostic] of [
    ['extra key', d => { d.extra = true; }, /invalid keys in handTableDerivation/],
    ['missing input key', d => { delete d.inputs[0].filed; }, /invalid keys in handTableDerivation input/],
    ['non-finite value', d => { d.inputs[0].value = Infinity; }, /invalid handTableDerivation input value/],
    ['wrong difference', d => { d.inputs[0].value++; }, /handTableDerivation backwards value mismatch/],
    ['empty formula', d => { d.formulaDe = ''; }, /invalid handTableDerivation formulaDe/],
    ['empty inputs', d => { d.inputs = []; }, /invalid handTableDerivation inputs/],
    ['non-string currency', d => { d.inputs[0].currency = 0; }, /invalid handTableDerivation input value or currency/],
  ]) {
    const broken = { ...f, file: clone(f.file), manifest: clone(f.manifest) };
    mutate(broken.manifest.records.find(r => r.handTableDerivation).handTableDerivation); rehash(broken);
    assert.throws(() => p.validateProvenance([broken.file], broken.manifest), diagnostic, name);
    console.log('RED p154: ' + name + ' rejected on a copy');
  }
});

test('p154: every record without a hand-table derivation keeps the independent pre-P154 ID', () => {
  const f = p154Fixture(p154Case('ARCC', '2026-06-30'));
  for (const r of f.manifest.records) {
    assert.equal(r.handTableDerivation, null);
    const oldRecord = Object.fromEntries(p.RECORD_FIELDS.filter(key => key !== 'handTableDerivation')
      .map(key => [key, key === 'id' ? null : r[key]]));
    assert.equal(r.id, 'e-' + p.valueHash(oldRecord));
  }
});

test('p154: published-style manifests with no handTableDerivation key still validate', () => {
  const f = fixture(), ids = f.manifest.records.map(r => r.id);
  for (const r of f.manifest.records) delete r.handTableDerivation;
  rehash(f);
  assert.equal(p.validateProvenance([f.file], f.manifest), true);
  assert.deepEqual(f.manifest.records.map(r => r.id), ids);
  const bytes = p.serializeManifest(f.manifest);
  f.file.provenanceManifestSha256 = p.sha256(bytes);
  assert.equal(p.validateProvenance([f.file], bytes), true);
});

test('p154: a present derivation binds its formula and input values into the evidence ID', () => {
  for (const [c, mutate] of [
    [p154Case('ARCC', '2025-12-31'), d => { d.formulaDe += ' (geprüft)'; }],
    [p154Case('OXLC', '2025-03-31'), d => { d.inputs[0].value++; }],
  ]) {
    const f = p154Fixture(c), good = clone(f.manifest);
    good.records = [good.records.find(r => r.correctionCaseId === c.caseId)];
    assert.equal(p.validateProvenance([], good), true);
    const broken = clone(good), r = broken.records[0];
    mutate(r.handTableDerivation);
    assert.throws(() => p.validateProvenance([], broken), /evidence id does not match expanded record/);
    r.id = 'e-' + p.valueHash({ ...r, id: null });
    assert.notEqual(r.id, good.records[0].id);
    assert.equal(p.validateProvenance([], broken), true);
  }
  const broken = clone(p154Fixture(p154Case('ARCC', '2025-12-31')).manifest);
  const r = broken.records.find(r => r.handTableDerivation);
  broken.records = [r]; r.handTableDerivation.inputs[0].value++;
  r.id = 'e-' + p.valueHash({ ...r, id: null });
  assert.throws(() => p.validateProvenance([], broken), /handTableDerivation backwards value mismatch/);
});

test('historical reviews do not break the next run or turn self-review into independence', () => {
  const f = fixture(snapshot(), [], undefined, true), mc = f.manifest.records.find(r => r.fieldPath === 'marketCap');
  const review = reviewFor(mc, 'prior-run');
  const next = { rows: [rowFor(snapshot())] };
  const selfReview = reviewFor(mc, 'self-review', 'creator-session');
  const manifest = p.buildProvenance([next], { runId: 'another-run', reviews: [review, selfReview], snapshotFor: () => completeSources(snapshot()) });
  assert.equal(next.rows[0].fieldStatus.marketCap.verification, 'unchecked');
  assert.equal(manifest.reviews.length, 0);
  const s = snapshot(); s.marketCap.value = 42;
  assert.equal(fixture(s, [review]).manifest.reviews.length, 0);
  const superseder = { ...review, id: 'superseder', evidenceIds: ['historical-only'], supersedesReviewId: review.id };
  assert.equal(fixture(snapshot(), [review, superseder]).row.verification.status, 'unchecked');
});

test('missing originals, source gaps and unchecked cohorts cannot become verified', () => {
  for (const mutate of [
    r => { r.missingReason = 'source gap'; },
    r => { r.derivation.cohortVerificationStatus = 'unchecked'; },
    r => { r.documentUrl = null; },
    r => { r.page = null; r.quote = null; r.anchor = null; },
  ]) {
    const first = fixture(snapshot(), [], undefined, true);
    const mc = first.manifest.records.find(r => r.fieldPath === 'marketCap');
    const reviewed = fixture(snapshot(), [reviewFor(mc, 'review')], undefined, true);
    assert.equal(reviewed.row.fieldStatus.marketCap.verification, 'reproduced');
    mutate(reviewed.manifest.records.find(r => r.fieldPath === 'marketCap')); rehash(reviewed);
    assert.throws(() => p.validateProvenance([reviewed.file], reviewed.manifest), /independent review/);
  }
});

test('actual exchange-filled revenue retains its source and retrieval time', () => {
  const { applyResult } = require('../lib/exchange-quarter-check.js');
  const s = snapshot(); s.meta.reportingCurrency = 'TWD'; s.meta.tradingCurrency = 'TWD';
  const filled = applyResult(s, { withhold: [], category: 'would-fill', line: 'revenue', fill: {
    index: 4, period: '2025-06-30', nativeValue: 100, derivation: 'printed-quarter', operands: [],
    source: 'MOPS t164sb04', sourceId: 'fixture', dataDate: '2026-09-01', fetchedAt: '2026-10-01T00:00:00Z', reason: 'Fixture',
  } });
  const r = p.captureSnapshot(filled).inputs[1];
  assert.equal(r.provider, 'MOPS t164sb04'); assert.equal(r.sourceType, 'exchange');
  assert.equal(r.retrievedAt, '2026-10-01T00:00:00Z');
});

test('own cell and matched period times survive reload; unstamped cells never inherit snapshot time', () => {
  const s = snapshot(), previous = snapshot(), oldTime = '2026-09-01T08:00:00Z';
  previous.meta.fetchedAt = oldTime;
  for (const snap of [previous, s]) snap.meta.statementPeriods = { revenueQ: snap.timeseries.revenueQEnds.map(end => ({
    end, duration: '3M', currency: 'USD', unit: 'currency', basis: 'reported', fetchedAt: snap.meta.fetchedAt,
  })) };
  s.timeseries.revenueQ[4] = null;
  preserveReloadHistory(s, previous);
  assert.equal(s.meta.statementPeriods.revenueQ[4].fetchedAt, oldTime);
  const inputs = p.captureSnapshot(s).inputs;
  assert.equal(inputs[0].retrievedAt, s.meta.fetchedAt);
  assert.equal(inputs[1].retrievedAt, oldTime);
  assert.notEqual(inputs[1].retrievedAt, s.meta.fetchedAt);
  delete s.meta.statementPeriods;
  assert.equal(p.captureSnapshot(s).inputs[1].retrievedAt, oldTime); // retained field/end marker
  delete s.meta.reloadHistoryRetained;
  assert(p.captureSnapshot(s).inputs.every(r => r.retrievedAt === null));
  for (const key of ['retrievedAt', 'fetchedAt', 'asOf']) {
    s.timeseries.revenueQ[4] = { value: 100, [key]: oldTime };
    assert.equal(p.captureSnapshot(s).inputs[1].retrievedAt, oldTime);
  }
  s.timeseries.revenueQ[4] = { value: 100 };
  s.meta.statementPeriods = { revenueQ: [{ end: '1999-12-31', fetchedAt: oldTime }] };
  assert.equal(p.captureSnapshot(s).inputs[0].retrievedAt, null); // wrong period is not this cell
  s.marketCap.asOf = '2026-10-03T09:00:00Z';
  assert.equal(p.captureSnapshot(s).marketCap.retrievedAt, s.marketCap.asOf);
  assert.equal(p.captureSnapshot(s).marketCap.observedAt, null); // fetch clock is not quote clock
});

function correctedCap(kind) {
  const s = snapshot(), ads = kind === 'ads', ticker = ads ? 'HSAI' : 'ANDG';
  const table = ads ? loadAdsHandTable() : loadShareCountTable(), entry = table[ticker];
  Object.assign(s.meta, { ticker, asOf: '2026-10-03T09:00:00Z', priceCurrency: 'USD',
    impliedSharesOutstanding: ads ? entry.yahooOrdinaryShares : entry.wrongShares[0] });
  s._pullMode = 'price-only'; s._pullModeAt = s.meta.asOf;
  s.price = { regularMarketPrice: ads ? 16 : 57.14, currencyUnit: 'USD' };
  s.marketCap = { value: s.price.regularMarketPrice * s.meta.impliedSharesOutstanding, source: 'yahoo_quote', asOf: s.meta.asOf };
  assert.equal((ads ? applyAdsHandTable : applyShareCountTable)(s, ticker, s.price.regularMarketPrice, table).status, 'corrected');
  return s;
}

test('share-count cap is the applier calculation with separate price, shares and original vendor cap', () => {
  const s = correctedCap('shares'), entry = loadShareCountTable().ANDG;
  // Match the real vendor numerator, including its arithmetic order.
  s.marketCap.yahooValue = 1059399040;
  s.marketCap.value = 1059399040 * (entry.shares / (1059399040 / 57.14));
  s.price.regularMarketTime = '2026-10-02T20:00:00Z';
  const before = JSON.stringify(s), f = fixture(s), cap = f.manifest.records.find(r => r.fieldPath === 'marketCap');
  const [price, shares, vendor] = cap.derivation.inputIds.map(id => f.manifest.records.find(r => r.id === id));
  assert.equal(JSON.stringify(s), before);
  assert.equal(cap.sourceType, 'calculation'); assert.equal(cap.derivation.methodId, 'marketCapFromShares');
  assert.equal(cap.normalizedValue, 6450385007.48); assert.equal(cap.normalizedValue, f.row.marketCap);
  assert.equal(vendor.normalizedValue * (shares.normalizedValue / (vendor.normalizedValue / price.normalizedValue)), cap.normalizedValue);
  assert.equal(cap.missingReason, null); assert.equal(cap.quote, null); assert.equal(cap.retrievedAt, null);
  assert.equal(price.sourceType, 'vendor'); assert.equal(price.provider, 'Yahoo Finance');
  assert.equal(price.nativeValue, 57.14); assert.equal(price.nativeCurrency, 'USD'); assert.equal(price.quote, null);
  assert.equal(price.retrievedAt, s.meta.asOf); assert.equal(price.observedAt, s.price.regularMarketTime);
  assert.equal(shares.sourceType, 'handTable'); assert.equal(shares.nativeValue, entry.shares);
  assert.equal(shares.nativeUnit, 'shares'); assert.equal(shares.quote, entry.source.quote);
  assert.equal(shares.documentUrl, entry.source.url); assert.equal(shares.retrievedAt, entry.verifiedAt);
  assert.equal(shares.correctionCaseId, 'hand-table:shares:ANDG');
  for (const mutate of [
    x => { x.price.regularMarketPrice++; }, x => { delete x.price; },
    x => { x.marketCap.yahooValue++; }, x => { x.marketCap.value++; },
    x => { x._pullModeAt = '2026-10-02T09:00:00Z'; },
    x => { x.marketCap.asOf = '2026-10-02T09:00:00Z'; },
    x => { x.meta.tradingCurrency = 'EUR'; },
  ]) {
    const broken = clone(s); mutate(broken);
    assert(p.captureSnapshot(broken).marketCap.missingReason);
  }
  const unstamped = clone(s); delete unstamped._pullMode;
  assert.equal(p.captureSnapshot(unstamped).marketCapInputs[0].retrievedAt, null);
});

test('ADS ratio evidence never pretends to prove shares; irreproducible product prevents a claim', () => {
  const s = correctedCap('ads'), f = fixture(s), cap = f.manifest.records.find(r => r.fieldPath === 'marketCap');
  const [price, shares, ratio, vendor] = cap.derivation.inputIds.map(id => f.manifest.records.find(r => r.id === id));
  assert.equal(cap.sourceType, 'calculation'); assert.equal(cap.derivation.methodId, 'marketCapFromAds');
  assert.equal(cap.derivation.expression, 'input[3] / input[2]');
  assert.equal(vendor.normalizedValue / ratio.normalizedValue, cap.normalizedValue);
  assert.equal(price.normalizedValue * shares.normalizedValue / ratio.normalizedValue, cap.normalizedValue);
  assert.equal(cap.missingReason, null); assert.equal(cap.quote, null); assert.equal(cap.retrievedAt, null);
  assert.equal(price.observedAt, null); assert.equal(price.nativeCurrency, 'USD');
  assert.equal(shares.sourceType, 'handTable'); assert.equal(shares.nativeValue, 1257137688);
  assert.equal(shares.nativeUnit, 'shares'); assert.equal(shares.quote, null); assert.equal(shares.documentUrl, null);
  assert(shares.missingReason); assert.equal(shares.retrievedAt, '2026-09-26');
  assert.equal(ratio.nativeValue, 8); assert.equal(ratio.retrievedAt, '2026-09-26');
  assert.equal(ratio.quote, 'Following the ADS Ratio Change, each ADS now represents eight (8) Class B ordinary shares.');
  s.price.regularMarketPrice = 15.38; s.marketCap.yahooValue = 19334776832; s.marketCap.value = 2416847104;
  const real = fixture(s), root = real.manifest.records.find(r => r.fieldPath === 'marketCap');
  assert.equal(root.normalizedValue, s.marketCap.value); assert(root.missingReason);
  assert.equal(real.row.fieldStatus.marketCap.verification, 'unchecked');
  assert.notEqual(15.38 * shares.nativeValue / 8, s.marketCap.value);
  for (const mutate of [x => { x.marketCap.ordinaryPerAds = 2; }, x => { x.meta.impliedSharesOutstanding++; }]) {
    const broken = correctedCap('ads'); mutate(broken); assert(p.captureSnapshot(broken).marketCap.missingReason);
  }
});

test('Q4 correction follows the actual selected quarter and documented source', () => {
  const c = require('../configs/yahoo-q4-known-cases.json').cases.find(c => c.field === 'revenueQ' && c.replacementNativeValue !== null);
  const s = snapshot(); Object.assign(s.meta, { ticker: c.listingAliases[0], reportingCurrency: c.nativeCurrency });
  s.annual = { annualRev: [c.inputFingerprint.annualNativeValue], annualRevEnds: [c.period] };
  s.timeseries = { revenueQ: [c.expectedBadValue, 2, 2, 2, 100].map(value => ({ value })),
    revenueQEnds: [c.period, '2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31'] };
  const applied = applyKnownCases(s);
  assert(applied.events.some(e => e.status === 'corrected' && e.field === 'revenueQ'));
  const r = fixture(applied.snapshot).manifest.records.find(r => r.correctionCaseId === c.caseId);
  assert(r); assert.equal(r.documentUrl, c.sources[0].url); assert.equal(r.quote, c.sources[0].quote ?? null);
});

test('share-count application versus table membership; statement scope and missing source URL', () => {
  const s = snapshot(), table = loadShareCountTable(), row = table.ANDG;
  s.meta.ticker = 'ANDG'; s.marketCap = { value: row.wrongShares[0] * 50, source: 'yahoo_quote', asOf: '2026-10-03' };
  s.price = { regularMarketPrice: 50 };
  assert.equal(fixture(s).manifest.records.find(r => r.fieldPath === 'marketCap').sourceType, 'vendor');
  assert.equal(applyShareCountTable(s, 'ANDG', 50, table).status, 'corrected');
  assert.equal(fixture(s).manifest.records.find(r => r.fieldPath === 'marketCap').correctionCaseId, 'hand-table:shares:ANDG');
  const st = snapshot(); st.meta.ticker = 'EMBJ'; st.meta.reportingCurrency = 'BRL';
  st.annual.annualRev = [100, 90]; st.metrics = { revenueTTM: 500 };
  assert.equal(statementFactor(st, 'BRL', 0.2, loadStatementCurrencyTable()).status, 'corrected');
  st.meta.reportingCurrency = 'USD';
  const r = fixture(st).manifest.records.find(r => r.sourceType === 'handTable');
  assert.equal(r.documentUrl, null); assert(r.qualityWarnings.includes('source link missing'));
  st.meta.statementCurrencySeries = 'annual';
  assert.equal(fixture(st).manifest.records.filter(r => r.sourceType === 'handTable').length, 0);
});

test('P142 German source titles reach the manifest without the former English descriptions', () => {
  const statements = loadStatementCurrencyTable();
  assert.equal(statements['PBR-A'].source, 'Die Konzernabschlüsse in den SEC-Formularen 20-F/6-K sind in US-Dollar dargestellt; der Umsatz 2024 von 91.416 Mio. USD entspricht dem unverarbeiteten Jahreswert von Yahoo.');
  assert.equal(loadShareCountTable().ANDG.source.form, 'Der Prospekt im Formular 424B4 vom 2026-08-20 mit der Zugangsnummer 0001193125-26-359181 beschreibt das Angebot im Abschnitt „The offering“.');
  for (const [ticker, entry] of Object.entries(statements)) {
    const s = snapshot(); s.meta.ticker = ticker; s.meta.reportingCurrency = entry.yahooFinancialCurrency;
    s.annual.annualRev = [100, 90]; s.metrics = { revenueTTM: 500 };
    assert.equal(statementFactor(s, entry.yahooFinancialCurrency, 0.2, statements).status, 'corrected');
    s.meta.reportingCurrency = 'USD';
    if (entry.series === 'annual') s.timeseries = {};
    const records = fixture(s).manifest.records.filter(r => r.sourceType === 'handTable');
    const titles = records.map(r => r.documentTitle);
    assert.ok(titles.length > 0, ticker + ': real manifest title exists');
    assert.ok(titles.every(title => title === entry.source && !/consolidated statements|same issuer|annual filing|matches Yahoo|revenue US\$|results pp\./.test(title)), ticker);
    // German wording must retain the page tokens consumed by sourceDocument.
    const pages = { 'VALE3.SA': '33', 'XVALO.MC': '33', YPF: '13,72', 'YPFD.BA': '13,72', '6269.T': '1-2' };
    if (pages[ticker]) assert.ok(records.every(r => r.page === pages[ticker]), ticker + ': source page preserved');
  }
  for (const [ticker, entry] of Object.entries(loadShareCountTable())) {
    const s = snapshot(); s.meta.ticker = ticker; s.meta.asOf = '2026-10-06';
    s.marketCap = { value: entry.wrongShares[0] * 50, source: 'yahoo_quote', asOf: '2026-10-06' };
    s.price = { regularMarketPrice: 50 };
    assert.equal(applyShareCountTable(s, ticker, 50, loadShareCountTable()).status, 'corrected');
    const titles = fixture(s).manifest.records.filter(r => r.sourceType === 'handTable').map(r => r.documentTitle);
    assert.ok(titles.includes(entry.source.form), ticker + ': share-count title reaches manifest');
    assert.ok(titles.every(title => !/prospectus of|for the period ended|cover page/.test(title || '')));
  }
});

test('annual/newer-record legs and R40 rounding keep original value hashes', () => {
  const s = snapshot(); s.timeseries = {};
  assert.equal(fixture(s).row.revGrowthBasis, 'year');
  s.meta.annualRevNewerYear = { end: '2026-06-30', priorEnd: '2025-06-30', revenue: 151, priorRevenue: 121, priorStored: 120, currency: 'EUR' };
  const f = fixture(s, [], 'round1');
  assert.equal(f.row.revGrowthBasis, 'yearNewerRecord');
  assert.equal(f.row.revGrowthYoYPct, Math.round((151 / 121 - 1) * 1000) / 10);
  assert(f.manifest.records.filter(r => r.fieldPath.startsWith('meta.')).every(r => r.nativeCurrency === 'EUR' && r.fx.rate === null));
});

test('atomic manifest hash uses delivered bytes and review folder is optional/read-only', () => {
  const dir = path.join(tmp, 'atomic'), absent = path.join(dir, 'verification-records');
  const file = { rows: [rowFor(snapshot())] };
  const m = p.writeProvenance([file], { outDir: dir, reviewRoot: absent, snapshotFor: () => p.captureSnapshot(snapshot()) });
  assert.equal(fs.existsSync(absent), false);
  const bytes = fs.readFileSync(path.join(dir, file.provenanceManifest));
  assert.equal(p.sha256(bytes), file.provenanceManifestSha256);
  assert(p.validateProvenance([file], bytes));
  const reviewsDir = path.join(tmp, 'review-fixture', '2026-10-03'); fs.mkdirSync(reviewsDir, { recursive: true });
  const review = reviewFor(m.records[0], 'fixture-review');
  const reviewFile = path.join(reviewsDir, 'fixture.json'); fs.writeFileSync(reviewFile, JSON.stringify(review));
  const before = fs.readFileSync(reviewFile);
  assert.deepEqual(p.readReviews(path.dirname(reviewsDir)), [review]);
  assert.deepEqual(fs.readFileSync(reviewFile), before);
  assert.throws(() => p.validateProvenance([file], Buffer.concat([bytes, Buffer.from('\n')])), /exact bytes/);
});

test('one writer session reuses evidence without changing lineage; legacy missing files remain the existing gate responsibility', () => {
  const first = { rows: [rowFor(snapshot())] }, second = clone(first);
  const options = { snapshotFor: () => p.captureSnapshot(snapshot()) };
  const a = p.buildProvenance([first], { ...options, generatedAt: '2026-10-03T09:31:00Z' });
  const b = p.buildProvenance([second], { ...options, generatedAt: '2026-10-03T09:32:00Z' });
  assert.notEqual(a.runId, b.runId);
  assert.deepEqual(first.rows, second.rows);
  assert.deepEqual(a.records, b.records);
  assert.deepEqual(p.provenanceErrors(tmp, ['absent.json']), []);
  assert.equal(p.provenanceErrors(tmp, ['absent.json'], true).length, 1);
});

test('pence quotes trace market capitalization in GBP major units with the actually applied factor', () => {
  for (const currency of ['GBp', 'GBX', 'GBPENCE']) {
    const s = snapshot();
    Object.assign(s.meta, { tradingCurrencyOriginal: currency, tradingFxRateApplied: 0.013240473,
      reportingCurrencyOriginal: 'EUR', reportingCurrency: 'USD', fxConverted: true, fxRateApplied: 1.1 });
    const mc = p.captureSnapshot(s).marketCap;
    assert.equal(mc.nativeCurrency, 'GBP'); assert.equal(mc.nativeValue, null);
    assert.equal(mc.fx.fromCurrency, 'GBP'); assert.equal(mc.fx.rate, 0.013240473 * 100);
    delete s.meta.tradingFxRateApplied; s.meta.reportingCurrencyOriginal = 'GBP'; s.meta.fxRateApplied = 1.3240473;
    assert.equal(p.captureSnapshot(s).marketCap.fx.rate, 1.3240473); // major rate, never multiplied twice
    s.meta.reportingCurrencyOriginal = 'EUR';
    assert.equal(p.captureSnapshot(s).marketCap.fx.rate, null);
  }
  const s = snapshot(); Object.assign(s.meta, { tradingCurrencyOriginal: 'GBP', tradingFxRateApplied: 1.3 });
  assert.equal(p.captureSnapshot(s).marketCap.fx.rate, 1.3);
});

test('four red proofs on copies leave the protected fixture byte-identical', () => {
  const live = path.join(tmp, 'protected.json'); fs.writeFileSync(live, JSON.stringify(fixture()));
  const before = p.sha256(fs.readFileSync(live));
  const breaks = [
    ['missing-id', f => { f.row.provenance.marketCap = ['absent']; f.file.rows[0] = f.row; }, /missing evidence id/],
    ['cycle', f => { f.manifest.records[0].derivation.inputIds = [f.manifest.records[0].id]; }, /cycle/],
    ['wrong-hash', f => { f.manifest.records[0].valueHash = '0'.repeat(64); }, /valueHash/],
    ['non-USD', f => { f.manifest.records.find(r => r.fieldPath === 'marketCap').normalizedCurrency = 'EUR'; }, /must be USD/],
  ];
  for (const [name, corrupt, expected] of breaks) {
    const target = path.resolve(tmp, name + '.json');
    assert.notEqual(target, path.resolve(live)); assert(target.startsWith(path.resolve(tmp) + path.sep));
    const f = JSON.parse(fs.readFileSync(live, 'utf8')); corrupt(f); rehash(f);
    fs.writeFileSync(target, JSON.stringify(f));
    const broken = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.throws(() => p.validateProvenance([broken.file], broken.manifest), expected);
    console.log('RED ' + name + ': rejected as expected');
  }
  assert.equal(p.sha256(fs.readFileSync(live)), before);
  console.log('Protected fixture SHA256 before/after: ' + before);
});

test('duplicates, cohort edges, exported value changes, counts and unsupported fields fail loudly', () => {
  for (const [corrupt, expected] of [
    [f => f.manifest.records.push(clone(f.manifest.records[0])), /exactly once/],
    [f => { f.manifest.records[0].derivation.cohortInputIds = ['missing-cohort']; }, /missing evidence/],
    [f => { f.manifest.records[0].derivation.cohortInputIds = [f.manifest.records[0].id]; }, /cycle/],
    [f => { f.row.marketCap = 42; }, /exported value/],
    [f => { f.file.verificationSummary.fullyVerifiedRows = 1; }, /backwards count/],
    [f => { f.manifest.records[0].extra = true; }, /invalid keys/],
    [f => { f.row.verification.status = 'verified'; }, /independent review/],
  ]) { const f = fixture(); corrupt(f); rehash(f); assert.throws(() => p.validateProvenance([f.file], f.manifest), expected); }
});

test('public fields reject email, personal-name fields and credential-like strings', () => {
  const f = fixture(); p.assertPublic(f.file); p.assertPublic(f.manifest);
  const email = 'fixture' + String.fromCharCode(64) + 'example.invalid';
  for (const bad of [email, 'gh' + 'p_' + 'x'.repeat(30), 'https://example.invalid/?' + 'token=example']) {
    assert.throws(() => p.assertPublic({ quote: bad }), /prohibited/);
  }
  assert.throws(() => p.assertPublic({ ['reviewer' + 'Name']: 'fixture' }), /prohibited/);
  p.assertPublic({ correctionCaseId: 'nsk-2026-06-30-revenueQ' });
});

test('additive checker permits only scoped fields and provenance files, with no exclusions', () => {
  const base = path.join(tmp, 'base'), head = path.join(tmp, 'head');
  fs.mkdirSync(base); fs.mkdirSync(head);
  const original = { branch: 'energy', generated_at: '2026-10-03T09:31:00Z', profitable: [rowFor(snapshot())], unprofitable: [] };
  fs.writeFileSync(path.join(base, 'energy.json'), JSON.stringify(original));
  const additive = clone(original); p.buildProvenance([additive], { snapshotFor: () => p.captureSnapshot(snapshot()) });
  const target = path.join(head, 'energy.json'); fs.writeFileSync(target, JSON.stringify(additive));
  const compare = () => compareExports(base, head, () => {});
  assert.equal(compare().differences, 0); assert.equal(compare().rows, 1); assert(compare().leafValues > 0);
  fs.writeFileSync(target, JSON.stringify({ ...additive, generated_at: '2026-10-04T09:31:00Z' }));
  assert(compare().differences > 0);
  fs.writeFileSync(target, JSON.stringify(additive)); assert.equal(compare().differences, 0);
  fs.writeFileSync(target, JSON.stringify({ ...original, arbitrary: true })); assert(compare().differences > 0);
  fs.writeFileSync(target, JSON.stringify(additive)); assert.equal(compare().differences, 0);
  fs.writeFileSync(path.join(base, 'survival.json'), JSON.stringify({ rows: [rowFor(snapshot())] }));
  assert(compare().differences > 0); // missing existing file
  fs.writeFileSync(path.join(head, 'survival.json'), JSON.stringify({ rows: [rowFor(snapshot())] }));
  assert.equal(compare().differences, 0);
  fs.writeFileSync(path.join(head, 'survival.json'), JSON.stringify({ rows: [{ ...rowFor(snapshot()), provenance: {} }] }));
  assert(compare().differences > 0); // unscoped addition
});

function contentExports(name, board = 'hypergrowth') {
  const relative = board === 'hypergrowth' ? 'energy.json' : 'rule40/overview.json';
  const roots = ['A', 'B'].map(sessionId => {
    const dir = path.join(tmp, name, sessionId), s = snapshot();
    const file = { generated_at: '2026-10-03T09:31:00Z', ...(board === 'hypergrowth'
      ? { branch: 'energy', profitable: [rowFor(s)], unprofitable: [] } : { rows: [rowFor(s)] }) };
    p.writeProvenance([file], { outDir: dir, board, runId: sessionId,
      generatedAt: sessionId === 'A' ? '2026-10-03T09:31:00Z' : '2026-10-04T09:32:00Z',
      creator: { engine: 'node', model: null, sessionId }, snapshotFor: () => p.captureSnapshot(s) });
    fs.writeFileSync(path.join(dir, relative), JSON.stringify(file));
    if (board === 'hypergrowth') {
      const { branch, profitable, unprofitable, ...header } = file;
      fs.writeFileSync(path.join(dir, 'overview.json'), JSON.stringify({ ...header, rows: profitable }));
    }
    return dir;
  });
  return { base: roots[0], head: roots[1], relative, manifest: p.MANIFEST_PATHS[board] };
}
const exportHashes = dir => jsonFiles(dir).map(relative => [relative, p.sha256(fs.readFileSync(path.join(dir, relative)))]);
const compareContent = (base, head, log = () => {}) => compareExports(base, head, log, { provenanceContent: true });

test('P122: equal content across creator sessions compares equal only with the flag, without writes', () => {
  for (const board of ['hypergrowth', 'rule40']) {
    const { base, head, manifest } = contentExports('sessions-' + board, board);
    const before = [exportHashes(base), exportHashes(head)];
    assert(compareExports(base, head, () => {}).differences > 0);
    assert.equal(compareContent(base, head).differences, 0);
    assert.deepEqual([exportHashes(base), exportHashes(head)], before);
    // Expanded and compact wire forms represent the same record content.
    const target = path.join(head, manifest), expanded = JSON.parse(fs.readFileSync(target));
    expanded.records = expanded.records.map(p.expandRecord);
    fs.writeFileSync(target, JSON.stringify(expanded));
    assert.equal(compareContent(base, head).differences, 0);
  }
});

test('P122: each content change is independently red on a copy', () => {
  const { base, head, relative, manifest } = contentExports('content-breaks');
  const before = [exportHashes(base), exportHashes(head)];
  const records = JSON.parse(fs.readFileSync(path.join(head, manifest))).records;
  const contentId = record => {
    const content = p.expandRecord(record);
    for (const key of ['id', 'creatorSessionId', 'createdAt']) delete content[key];
    const id = p.sha256(JSON.stringify(content));
    assert(!records.some(record => record.id === id));
    return id;
  };
  const cases = [
    ['normalized-value', manifest, m => { m.records[0].normalizedValue++; }, 'normalizedValue'],
    ['document-url', manifest, m => { m.records[0].documentUrl = 'https://example.invalid/changed'; }, 'documentUrl'],
    ['native-value', manifest, m => { m.records[0].nativeValue++; }, 'nativeValue'],
    ['value-hash', manifest, m => { m.records[0].valueHash = '0'.repeat(64); }, 'valueHash'],
    ['field-path', manifest, m => { m.records[0].fieldPath = 'other'; }, 'fieldPath'],
    ['expression', manifest, m => { m.records.find(r => r.fieldPath === 'revGrowthYoYPct').derivation.expression = 'input[0]'; }, 'expression'],
    ['unknown-evidence', relative, f => { f.profitable[0].provenance.marketCap = ['e-unknown']; }, 'provenance.marketCap'],
    ['canonical-token-row', relative, f => {
      f.profitable[0].provenance.marketCap = [contentId(records.find(r => r.fieldPath === 'marketCap'))];
    }, 'provenance.marketCap'],
    ['canonical-token-input', manifest, m => {
      const growth = m.records.find(r => r.fieldPath === 'revGrowthYoYPct');
      growth.derivation.inputIds[0] = contentId(m.records.find(r => r.id === growth.derivation.inputIds[0]));
    }, 'derivation.inputIds'],
    ['scoped-value', relative, f => { f.profitable[0].marketCap = 42; }, 'marketCap'],
    ['unscoped-key', relative, f => { f.profitable[0].arbitrary = true; }, 'arbitrary'],
    ['verification-status', relative, f => { f.profitable[0].verification.status = 'verified'; }, 'verification.status'],
    ['export-time', relative, f => { f.generated_at = '2026-10-04T09:31:00Z'; }, 'generated_at'],
    ['marker-status', 'provenance/_failed.json', m => { m.status = 'failed'; }, 'status'],
    ['unknown-record-key', manifest, m => { m.records[0].extra = true; }, 'extra'],
    ['record-order', manifest, m => { m.records.reverse(); }, 'records.0'],
  ];
  for (const [name, file, corrupt, expected] of cases) {
    const target = path.resolve(tmp, 'content-break-' + name);
    assert.notEqual(target, path.resolve(base)); assert.notEqual(target, path.resolve(head));
    assert(target.startsWith(path.resolve(tmp) + path.sep));
    fs.cpSync(head, target, { recursive: true });
    assert.equal(compareContent(base, target).differences, 0, name + ': clean starting point');
    const targetFile = path.join(target, file), broken = JSON.parse(fs.readFileSync(targetFile));
    corrupt(broken); fs.writeFileSync(targetFile, JSON.stringify(broken));
    const messages = [];
    assert(compareContent(base, target, message => messages.push(message)).differences > 0, name);
    assert(messages.some(message => message.includes(expected)), name + ': intended difference');
    assert.deepEqual([exportHashes(base), exportHashes(head)], before);
    console.log('RED P122 ' + name + ': isolated difference detected; source hashes unchanged');
  }
});

test('P122: recursive operand and cohort IDs, review evidence and verification lists normalize by content', () => {
  const { base, head, relative, manifest } = contentExports('dependency-chain');
  const rawInputs = [], rawRoots = [];
  for (const dir of [base, head]) {
    const manifestFile = path.join(dir, manifest), m = JSON.parse(fs.readFileSync(manifestFile));
    const growth = m.records.find(r => r.fieldPath === 'revGrowthYoYPct');
    const inputs = growth.derivation.inputIds.map(id => m.records.find(r => r.id === id));
    assert.equal(inputs.length, 2);
    assert.equal((inputs[0].normalizedValue / inputs[1].normalizedValue - 1) * 100, growth.normalizedValue);
    rawInputs.push(inputs.map(r => r.id)); rawRoots.push(growth.id);
    growth.derivation.cohortInputIds = inputs.map(r => r.id);
    m.reviews = [{ ...reviewFor(growth, 'stable-review'), result: 'unverifiable' }];
    m.records.reverse(); // Dependencies now follow their parent, forcing recursive resolution.
    fs.writeFileSync(manifestFile, JSON.stringify(m));
    const target = path.join(dir, relative), file = JSON.parse(fs.readFileSync(target));
    file.profitable[0].verification.evidenceIds = [growth.id, ...growth.derivation.inputIds];
    fs.writeFileSync(target, JSON.stringify(file));
  }
  assert.notDeepEqual(rawInputs[0], rawInputs[1]); assert.notEqual(rawRoots[0], rawRoots[1]);
  assert.equal(compareContent(base, head).differences, 0);
  const target = path.join(head, manifest), good = fs.readFileSync(target);
  for (const key of ['reviewerSessionId', 'checkedAt', 'result']) {
    const broken = JSON.parse(good); broken.reviews[0][key] = 'changed';
    fs.writeFileSync(target, JSON.stringify(broken));
    assert(compareContent(base, head).differences > 0, key + ' must remain significant');
    fs.writeFileSync(target, good); assert.equal(compareContent(base, head).differences, 0);
  }
  for (const key of ['inputIds', 'cohortInputIds']) {
    const broken = JSON.parse(good), record = broken.records[0];
    record.derivation[key] = [record.id];
    fs.writeFileSync(target, JSON.stringify(broken));
    assert.throws(() => compareContent(base, head), /evidence dependency cycle/);
    fs.writeFileSync(target, good); assert.equal(compareContent(base, head).differences, 0);
  }
  const duplicate = JSON.parse(good); duplicate.records.push(clone(duplicate.records[0]));
  fs.writeFileSync(target, JSON.stringify(duplicate));
  assert.throws(() => compareContent(base, head), /duplicate evidence id/);
});

test('full boards permit neither provenance additions nor byte changes', () => {
  const base = path.join(tmp, 'full-base'), head = path.join(tmp, 'full-head');
  for (const dir of [base, head]) fs.mkdirSync(path.join(dir, 'full'), { recursive: true });
  const original = { branch: 'energy', profitable: [rowFor(snapshot())], unprofitable: [] };
  const bytes = JSON.stringify(original), target = path.join(head, 'full/energy.json');
  fs.writeFileSync(path.join(base, 'full/energy.json'), bytes); fs.writeFileSync(target, bytes);
  const compare = () => compareExports(base, head, () => {});
  assert.equal(compare().differences, 0);
  fs.writeFileSync(target, bytes + '\n'); assert(compare().differences > 0);
  const additive = clone(original); p.buildProvenance([additive]);
  fs.writeFileSync(target, JSON.stringify(additive)); assert(compare().differences > 0);
  fs.writeFileSync(target, bytes); assert.equal(compare().differences, 0);
});

test('(a) fixed filename replaces a different run with exactly one manifest per board', () => {
  for (const board of ['hypergrowth', 'rule40']) {
    const dir = path.join(tmp, 'two-builds', board);
    const file = { rows: [rowFor(snapshot())] };
    const first = p.writeProvenance([file], { outDir: dir, board, runId: 'first' });
    const relative = file.provenanceManifest;
    const firstBytes = fs.readFileSync(path.join(dir, relative));
    file.rows[0].marketCap = 17;
    const second = p.writeProvenance([file], { outDir: dir, board, runId: 'second' });
    const bytes = fs.readFileSync(path.join(dir, relative)), delivered = JSON.parse(bytes);
    assert.equal(relative, p.MANIFEST_PATHS[board]);
    assert.equal(file.provenanceManifest, relative);
    assert.notEqual(first.runId, second.runId);
    assert.equal(delivered.runId, file.provenanceRunId);
    assert.notDeepEqual(bytes, firstBytes);
    assert.deepEqual(delivered.records.map(p.expandRecord), second.records);
    // Exactly one manifest per board; next to it only the status marker, overwritten by the latest run.
    assert.deepEqual(fs.readdirSync(path.dirname(path.join(dir, relative))).sort(), ['_failed.json', board + '.json']);
    const marker = JSON.parse(fs.readFileSync(path.join(path.dirname(path.join(dir, relative)), '_failed.json')));
    assert.equal(marker.status, 'ok'); assert.equal(marker.provenanceRunId, 'second');
    assert.equal(marker.provenanceManifestSha256, p.sha256(bytes));
    assert(p.validateProvenance([file], bytes));
  }
});

test('(b) slim bytes expand losslessly; deleting any non-null source field is rejected', () => {
  const f = fixture(), bytes = p.serializeManifest(f.manifest), wire = JSON.parse(bytes);
  f.file.provenanceManifestSha256 = p.sha256(bytes);
  assert(p.validateProvenance([f.file], bytes));
  assert(bytes.length < JSON.stringify(f.manifest, null, 2).length);
  assert.deepEqual(wire.records.map(p.expandRecord), f.manifest.records);
  wire.records.map(p.expandRecord).forEach((r, i) => {
    assert.deepEqual(Object.keys(r).sort(), [...p.RECORD_FIELDS].sort());
    assert.deepEqual(Object.keys(r.fx).sort(), [...p.FX_FIELDS].sort());
    assert.deepEqual(Object.keys(r.derivation).sort(), [...p.DERIVATION_FIELDS].sort());
    assert.equal(r.id, 'e-' + p.valueHash(Object.fromEntries(p.RECORD_FIELDS.filter(key => key !== 'handTableDerivation')
      .map(key => [key, key === 'id' ? null : r[key]]))));
    assert.equal(r.valueHash, f.manifest.records[i].valueHash);
  });
  for (const mutate of [r => { delete r.provider; }, r => { delete r.derivation.inputIds; }]) {
    const broken = clone(wire); mutate(broken.records[0]);
    const badBytes = JSON.stringify(broken);
    f.file.provenanceManifestSha256 = p.sha256(badBytes);
    assert.throws(() => p.validateProvenance([f.file], badBytes), /expanded record|invalid dependency/);
  }
});

test('changed input in delivered slim manifest invalidates its independently verified dependent row', () => {
  const original = fixture(snapshot(), [], undefined, true);
  const reviews = original.manifest.records.filter(r => p.FIELDS.includes(r.fieldPath)).map((r, i) => reviewFor(r, 'input-review-' + i));
  const f = fixture(snapshot(), reviews, undefined, true);
  assert.equal(f.row.verification.status, 'verified');
  const live = path.join(tmp, 'verified-delivery.json'), target = path.resolve(tmp, 'tampered-input.json');
  assert.notEqual(target, path.resolve(live)); assert(target.startsWith(path.resolve(tmp) + path.sep));
  const goodBytes = p.serializeManifest(f.manifest);
  fs.writeFileSync(live, goodBytes); const before = p.sha256(fs.readFileSync(live));
  f.file.provenanceManifestSha256 = before;
  assert(p.validateProvenance([f.file], fs.readFileSync(live)));
  const broken = JSON.parse(goodBytes), growth = broken.records.find(r => r.fieldPath === 'revGrowthYoYPct');
  const input = broken.records.find(r => r.id === growth.derivation.inputIds[0]);
  input.normalizedValue++;
  input.valueHash = p.valueHash(input.normalizedValue); // Even a recomputed value hash cannot preserve the evidence ID.
  const badBytes = JSON.stringify(broken); fs.writeFileSync(target, badBytes);
  f.file.provenanceManifestSha256 = p.sha256(badBytes);
  assert.throws(() => p.validateProvenance([f.file], fs.readFileSync(target)), /evidence id does not match expanded record/);
  assert.equal(p.sha256(fs.readFileSync(live)), before);
  console.log('RED changed-input: verified dependent row rejected; protected SHA256 unchanged: ' + before);
});

function writerFixtures() {
  const fixture40 = require('./rule40-fixture.js');
  const r40 = require('../scripts/write-rule40-export.js');
  const r40Paths = fixture40.baueExport([{ row: fixture40.boardZeile() }]);
  // Execute the actual HG writer against a temporary root without changing its code.
  const root = path.join(tmp, 'hg-writer'), script = require.resolve('../scripts/write-findash-export.js');
  const Module = require('node:module'), vm = require('node:vm');
  const mod = { exports: {} }, snapDir = path.join(root, 'snapshots');
  const old = process.env.FINDASH_SNAPSHOTS_DIR;
  process.env.FINDASH_SNAPSHOTS_DIR = snapDir;
  try {
    vm.runInThisContext(Module.wrap(fs.readFileSync(script, 'utf8').replace(/^#![^\n]*/, '')), { filename: script })(
      mod.exports, Module.createRequire(script), mod, script, path.join(root, 'scripts'));
  } finally {
    if (old === undefined) delete process.env.FINDASH_SNAPSHOTS_DIR;
    else process.env.FINDASH_SNAPSHOTS_DIR = old;
  }
  const hg = mod.exports, source = path.join(root, 'outputs', 'hypergrowth');
  const out = path.join(root, 'outputs', 'findash-export', 'v1');
  fs.mkdirSync(path.join(source, 'full'), { recursive: true }); fs.mkdirSync(snapDir, { recursive: true });
  const snap = snapshot(); fs.writeFileSync(path.join(snapDir, 'TEST.json'), JSON.stringify(snap));
  const row = fixture40.boardZeile({ ticker: 'TEST', marketCap: 0, revGrowthYoYPct: p.captureSnapshot(snap).leg.pct,
    ipoRecency: 'mature', profitStreak: null });
  const counts = {};
  for (const branch of hg.BRANCHES) {
    const data = { profitable: branch === 'energy' ? [row] : [], unprofitable: [] };
    counts[branch] = { profitable: data.profitable.length, unprofitable: 0 };
    for (const prefix of ['', 'full']) fs.writeFileSync(path.join(source, prefix, branch + '.json'), JSON.stringify(data));
  }
  fs.writeFileSync(path.join(source, 'index.json'), JSON.stringify({ generatedFromSnapshots: 1, branches: hg.BRANCHES,
    counts, survivalCount: 0, excluded: {} }));
  // P118: the flat overview feed carries the same row as its branch board (formulaId = branch).
  fs.writeFileSync(path.join(source, 'overview.json'), JSON.stringify([{ ...row, formulaId: 'energy', track: 'profitable', overviewKind: 'gp', overviewValue: 0.1, overviewCompanion: null }]));
  fs.writeFileSync(path.join(source, 'survival.json'), '[]');
  return [
    { board: 'hypergrowth', root: out, relative: 'energy.json',
      build: writeProvenance => hg.build({ writeProvenance }),
      check: () => hg.validateExport(out, { requireProvenance: true }) },
    { board: 'rule40', root: r40Paths.v1Dir, relative: 'rule40/overview.json',
      build: writeProvenance => r40.build({ ...r40Paths, writeProvenance }),
      check: () => r40.check({ ...r40Paths, requireProvenance: true }).errors },
  ];
}

const integrations = writerFixtures();
test('(c) both writers ship complete baseline boards on helper throw, with marker and warning-only check', () => {
  for (const w of integrations) {
    let original;
    const warnings = [], warn = console.warn; console.warn = message => warnings.push(message);
    try {
      w.build((files, options) => {
        const { jsonFiles } = require('../scripts/check-export-additive.js');
        original = new Map(jsonFiles(w.root).map(relative => [relative, fs.readFileSync(path.join(w.root, relative))]));
        // Force a late helper failure AFTER all in-memory annotations and manifest writing.
        p.writeProvenance(files, options);
        throw new Error('forced helper failure');
      });
      assert(original.size >= (w.board === 'hypergrowth' ? 29 : 4));
      for (const [relative, bytes] of original) assert.deepEqual(fs.readFileSync(path.join(w.root, relative)), bytes, relative);
      const file = JSON.parse(fs.readFileSync(path.join(w.root, w.relative)));
      assert(p.rowsOf(file).length > 0);
      assert(p.HEADER_FIELDS.every(key => !Object.hasOwn(file, key)));
      assert(p.rowsOf(file).every(row => p.ROW_FIELDS.every(key => !Object.hasOwn(row, key))));
      const manifestFile = path.join(w.root, p.MANIFEST_PATHS[w.board]);
      assert.equal(fs.existsSync(manifestFile), false);
      const marker = JSON.parse(fs.readFileSync(path.join(path.dirname(manifestFile), '_failed.json')));
      assert.deepEqual(Object.keys(marker).sort(), ['schema', 'status', 'generated_at', 'board', 'reason'].sort());
      assert.equal(marker.status, 'failed');
      assert.equal(marker.board, w.board); assert.equal(marker.schema, p.SCHEMA); p.assertPublic(marker);
      assert.deepEqual(w.check(), []);
      assert.equal(warnings.filter(s => s === '::warning::provenance withheld: forced helper failure').length, 2);
    } finally { console.warn = warn; }
    console.log('WITHHELD ' + w.board + ': complete boards, no manifest, marker + build/check warnings, check exit 0');
  }
});

test('(d) present but corrupt provenance and partial row-only metadata still fail each writer check', () => {
  for (const w of integrations) {
    const target = path.join(w.root, w.relative), original = fs.readFileSync(target);
    const partial = JSON.parse(original); p.rowsOf(partial)[0].provenance = {};
    fs.writeFileSync(target, JSON.stringify(partial));
    assert(w.check().some(e => /manifest path|partially withheld/.test(e)));
    fs.writeFileSync(target, original);
    w.build(); // recovery OVERWRITES the old failure marker with status ok (gh-pages never deletes files)
    const manifestFile = path.join(w.root, p.MANIFEST_PATHS[w.board]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(manifestFile), '_failed.json'))).status, 'ok');
    assert.deepEqual(w.check(), []);
    const good = fs.readFileSync(target), corrupt = JSON.parse(good);
    corrupt.provenanceManifestSha256 = '0'.repeat(64);
    fs.writeFileSync(target, JSON.stringify(corrupt));
    assert(w.check().some(e => /exact bytes/.test(e)));
    fs.writeFileSync(target, good);
    const missingLinks = JSON.parse(good);
    p.rowsOf(missingLinks)[0].provenance.marketCap = [];
    fs.writeFileSync(target, JSON.stringify(missingLinks));
    assert(w.check().some(e => /invalid row evidence ids/.test(e)));
    fs.writeFileSync(target, good);
  }
});

test('(e) absent provenance without a failure marker fails each writer check', () => {
  for (const w of integrations) {
    const relativeFiles = w.board === 'hypergrowth' ? require('../scripts/write-findash-export.js').BRANCHES.map(b => b + '.json') : [w.relative];
    for (const relative of relativeFiles) {
      const file = path.join(w.root, relative), data = JSON.parse(fs.readFileSync(file));
      p.HEADER_FIELDS.forEach(key => { delete data[key]; });
      p.rowsOf(data).forEach(row => p.ROW_FIELDS.forEach(key => { delete row[key]; }));
      fs.writeFileSync(file, JSON.stringify(data));
    }
    // A successful build left an ok marker; stripped headers must still fail (status decides, not existence).
    assert(w.check().some(e => /missing provenance (without _failed.json marker|but the marker says ok)/.test(e)));
  }
});

test('(f) a failure marker is overwritten with status ok by the next success; --check decides on status plus header', () => {
  for (const w of integrations) {
    const target = path.join(w.root, w.relative);
    const markerFile = path.join(path.dirname(path.join(w.root, p.MANIFEST_PATHS[w.board])), '_failed.json');
    const warn = console.warn; console.warn = () => {};
    try { w.build(() => { throw new Error('forced helper failure'); }); } finally { console.warn = warn; }
    assert.equal(JSON.parse(fs.readFileSync(markerFile)).status, 'failed');
    const withheldBoard = fs.readFileSync(target);
    w.build();
    const marker = JSON.parse(fs.readFileSync(markerFile)), board = JSON.parse(fs.readFileSync(target));
    assert.deepEqual(Object.keys(marker).sort(), ['at', 'board', 'provenanceManifestSha256', 'provenanceRunId', 'schema', 'status']);
    assert.equal(marker.status, 'ok');
    assert.equal(marker.board, w.board);
    assert.equal(marker.provenanceRunId, board.provenanceRunId);
    assert.equal(marker.provenanceManifestSha256, board.provenanceManifestSha256);
    assert.deepEqual(w.check(), []);
    const okBytes = fs.readFileSync(markerFile);
    // ok marker whose hash does not match the header is rejected
    fs.writeFileSync(markerFile, JSON.stringify({ ...marker, provenanceManifestSha256: '0'.repeat(64) }));
    assert(w.check().some(e => /ok marker does not match the board header/.test(e)));
    // a stale failed marker next to present provenance is rejected
    fs.writeFileSync(markerFile, JSON.stringify({ schema: p.SCHEMA, status: 'failed', generated_at: marker.at, board: w.board, reason: 'old failure' }));
    assert(w.check().some(e => /marker still says failed/.test(e)));
    // an ok marker cannot excuse a board without provenance
    fs.writeFileSync(markerFile, okBytes);
    fs.writeFileSync(target, withheldBoard);
    assert(w.check().some(e => /missing provenance but the marker says ok/.test(e)));
    w.build();
    assert.deepEqual(w.check(), []);
  }
});

test('P118: overview.json rows carry the same provenance as their branch rows, against the same manifest', () => {
  const hgw = integrations.find(w => w.board === 'hypergrowth');
  hgw.build();
  const read = rel => JSON.parse(fs.readFileSync(path.join(hgw.root, rel), 'utf8'));
  const board = read('energy.json'), overview = read('overview.json');
  const b = p.rowsOf(board).find(r => r.ticker === 'TEST'), o = p.rowsOf(overview).find(r => r.ticker === 'TEST');
  assert(b && o, 'TEST row in both files');
  assert.equal(overview.provenanceManifest, p.MANIFEST_PATHS.hypergrowth);
  assert.equal(overview.provenanceManifestSha256, board.provenanceManifestSha256);
  assert.equal(overview.provenanceRunId, board.provenanceRunId);
  for (const field of p.FIELDS) assert.deepEqual(o.provenance[field], b.provenance[field], field + ': identical evidence ids');
  assert.deepEqual(o.fieldStatus, b.fieldStatus);
  assert.deepEqual(hgw.check(), []);
  // Break once on a copy: a foreign evidence id in the overview row makes --check red.
  const target = path.join(hgw.root, 'overview.json'), good = fs.readFileSync(target);
  const bad = JSON.parse(good); p.rowsOf(bad)[0].provenance.marketCap = ['e-' + '0'.repeat(64)];
  fs.writeFileSync(target, JSON.stringify(bad));
  assert(hgw.check().some(e => /overview|missing evidence|evidence/.test(e)));
  fs.writeFileSync(target, good);
  assert.deepEqual(hgw.check(), []);
});

console.log(`export-provenance: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
