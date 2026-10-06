'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../lib/export-provenance.js');
const { applyFinancialCases, table: financialTable } = require('../lib/financial-known-cases.js');
const { applyKnownCases } = require('../lib/yahoo-q4-known-cases.js');
const { applyShareCountTable, loadShareCountTable } = require('../lib/ads-hand-table.js');
const { statementFactor, loadStatementCurrencyTable } = require('../lib/statement-currency-hand-table.js');
const { compareExports } = require('../scripts/check-export-additive.js');
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
    assert.equal(r.retrievedAt, '2026-10-03T08:00:00Z');
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
  additive.generated_at = '2026-10-04T09:31:00Z'; fs.writeFileSync(target, JSON.stringify(additive));
  assert(compare().differences > 0);
  fs.writeFileSync(target, JSON.stringify({ ...original, arbitrary: true })); assert(compare().differences > 0);
  fs.writeFileSync(target, JSON.stringify(additive));
  fs.writeFileSync(path.join(base, 'overview.json'), JSON.stringify({ rows: [rowFor(snapshot())] }));
  assert(compare().differences > 0); // missing existing file
  fs.writeFileSync(path.join(head, 'overview.json'), JSON.stringify({ rows: [{ ...rowFor(snapshot()), provenance: {} }] }));
  assert(compare().differences > 0); // unscoped addition
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
    assert.deepEqual(fs.readdirSync(path.dirname(path.join(dir, relative))), [board + '.json']);
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
    assert.equal(r.id, 'e-' + p.valueHash({ ...r, id: null }));
    assert.equal(r.valueHash, f.manifest.records[i].valueHash);
  });
  for (const mutate of [r => { delete r.provider; }, r => { delete r.derivation.inputIds; }]) {
    const broken = clone(wire); mutate(broken.records[0]);
    const badBytes = JSON.stringify(broken);
    f.file.provenanceManifestSha256 = p.sha256(badBytes);
    assert.throws(() => p.validateProvenance([f.file], badBytes), /expanded record|invalid dependency/);
  }
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
  for (const name of ['overview', 'survival']) fs.writeFileSync(path.join(source, name + '.json'), '[]');
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
      assert.deepEqual(Object.keys(marker).sort(), ['schema', 'generated_at', 'board', 'reason'].sort());
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
    w.build(); // recovery removes the old failure marker
    const manifestFile = path.join(w.root, p.MANIFEST_PATHS[w.board]);
    assert.equal(fs.existsSync(path.join(path.dirname(manifestFile), '_failed.json')), false);
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
    assert(w.check().some(e => /missing provenance without _failed.json marker/.test(e)));
  }
});

console.log(`export-provenance: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
