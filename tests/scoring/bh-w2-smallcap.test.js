'use strict';
/**
 * Bug-hunt fixes, batch w2-smallcap (BH-014, BH-015, BH-016, BH-019) fuer
 * scripts/probe-smallcap-coverage.js. Reine Funktionen + ein require()-
 * Subprozess + statische Quelltext-Invarianten -> netzwerkfrei. BH-014 ist
 * eine Grundsatzentscheidung (skipped, siehe Batch-Return) und hat keinen
 * Logik-Test; nur die im selben Batch verlangte Report-Header-Limitation
 * wird als Vorhandensein-Check mitgeprueft. Standalone-Runner: node <datei>
 * (Exit 0/1).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'probe-smallcap-coverage.js');
const mod = require(SCRIPT);
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

// Dieselben vier Revenue-Konzepte wie SEC_CONCEPTS.revenue im Skript
// (FIELD_DEFS.annualRevenue.xbrl), in derselben Prioritaetsreihenfolge.
const REVENUE_CONCEPTS = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet'
];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

// --- BH-015: Q4 = FY minus 9M nur bei identischer Concept+Unit-Fakt-Identitaet ---
test('BH-015: cross-concept FY(Revenues)/9M(SalesRevenueNet) does NOT fabricate a Q4 point', () => {
  const companyfacts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { start: '2024-01-01', end: '2024-12-31', val: 1000, form: '10-K', accn: '0001-25-000001', filed: '2025-02-15' }
      ] } },
      SalesRevenueNet: { units: { USD: [
        { start: '2024-01-01', end: '2024-09-30', val: 700, form: '10-Q', accn: '0001-24-000003', filed: '2024-11-01' }
      ] } }
    } }
  };
  const rows = mod.quarterlyFlow(companyfacts, REVENUE_CONCEPTS);
  const q4 = rows.find(r => r.date === '2024-12-31');
  assert.equal(q4, undefined, 'FY(Revenues) minus 9M(SalesRevenueNet) must not be subtracted across mismatched concepts');
});

test('BH-015 control: same-concept FY/9M still derives Q4 = FY - 9M (feature not gutted)', () => {
  const companyfacts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { start: '2024-01-01', end: '2024-12-31', val: 1000, form: '10-K', accn: '0001-25-000001', filed: '2025-02-15' },
        { start: '2024-01-01', end: '2024-09-30', val: 700, form: '10-Q', accn: '0001-24-000003', filed: '2024-11-01' }
      ] } }
    } }
  };
  const rows = mod.quarterlyFlow(companyfacts, REVENUE_CONCEPTS);
  const q4 = rows.find(r => r.date === '2024-12-31');
  assert.ok(q4, 'same-concept FY minus 9M must still derive a Q4 point');
  assert.equal(q4.value, 300);
});

test('BH-015: cross-concept case still keeps the directly-tagged discrete quarters untouched', () => {
  const companyfacts = {
    facts: { 'us-gaap': {
      Revenues: { units: { USD: [
        { start: '2024-01-01', end: '2024-03-31', val: 200, form: '10-Q', accn: 'A1', filed: '2024-05-01' },
        { start: '2024-01-01', end: '2024-12-31', val: 1000, form: '10-K', accn: 'A4', filed: '2025-02-15' }
      ] } },
      SalesRevenueNet: { units: { USD: [
        { start: '2024-01-01', end: '2024-09-30', val: 700, form: '10-Q', accn: 'A3', filed: '2024-11-01' }
      ] } }
    } }
  };
  const rows = mod.quarterlyFlow(companyfacts, REVENUE_CONCEPTS);
  const q1 = rows.find(r => r.date === '2024-03-31');
  assert.ok(q1 && q1.value === 200, 'a genuinely, directly-tagged quarter must still pass through unaffected');
  assert.equal(rows.find(r => r.date === '2024-12-31'), undefined);
});

// --- BH-016: toter Messlauf-1-Legacy-Pfad entfernt statt repariert ---
test('BH-016: requiring the script does not auto-start a run (require.main guard present)', () => {
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(SCRIPT)}); console.log('LOADED_OK');`],
    { encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 0, 'require() must load cleanly without triggering a run: ' + (r.stderr || ''));
  assert.match(r.stdout, /LOADED_OK/);
});

test('BH-016: dead Messlauf-1 path (mainMesslauf1, indexedSeries, secDataFromAnnualCache, fetchSecCompany, buildCoverage, buildMissingFields, buildMarkdown) is fully removed', () => {
  for (const dead of ['mainMesslauf1', 'indexedSeries', 'secDataFromAnnualCache', 'fetchSecCompany',
    'function buildCoverage', 'function buildMissingFields', 'function buildMarkdown(']) {
    assert.ok(!SOURCE.includes(dead), `${dead} must be fully removed as dead code, not left unreferenced`);
  }
});

// --- BH-019: atomarer Write + gemeinsamer Run-Hash + hermetischer Export ---
test('BH-019: buildRunHash is deterministic and sensitive to its input', () => {
  const a = mod.buildRunHash({ seed: 's', tickers: ['AAA', 'BBB'] });
  const b = mod.buildRunHash({ seed: 's', tickers: ['AAA', 'BBB'] });
  const c = mod.buildRunHash({ seed: 's', tickers: ['AAA', 'CCC'] });
  assert.equal(a, b, 'identical input must hash identically so a JSON/MD pair of the same run can be compared');
  assert.notEqual(a, c, 'different input must change the hash so a stale/mixed-generation pair is detectable');
  assert.match(a, /^[0-9a-f]{16}$/, 'short embeddable hex fingerprint');
});

test('BH-019: the binding Messlauf-2/XBRL reports are written via the atomic writer, not a bare fs.writeFileSync', () => {
  assert.ok(!/fs\.writeFileSync\(REPORT_M2/.test(SOURCE), 'REPORT_M2_* writes must go through writeFileAtomic (tmp+rename)');
  for (const call of ['writeFileAtomic(REPORT_M2_JSON', 'writeFileAtomic(REPORT_M2_MD',
    'writeFileAtomic(REPORT_M2_XBRL_JSON', 'writeFileAtomic(REPORT_M2_XBRL_MD']) {
    assert.ok(SOURCE.includes(call), `expected ${call} in the report-write path`);
  }
});

test('BH-019: core selection/Q4/alignment/coverage functions are exported for hermetic fixtures', () => {
  for (const fn of ['quarterlyFlow', 'annualFlow', 'alignedPairs', 'fieldSummary', 'axisSummary',
    'filterOperatingCompanyM2', 'yahooCoverageM2', 'xbrlCoverage', 'xbrlComparison']) {
    assert.equal(typeof mod[fn], 'function', `${fn} must be exported`);
  }
});

// --- BH-014 (Batch-Hinweis): Sampling-Bias mindestens als Report-Header-Limitation verankert ---
test('BH-014 (skipped/decision, nur Anker-Pflicht aus Batch-Hinweis): candidateBasisLimitation ist im Report + Markdown-Header verdrahtet', () => {
  assert.ok(SOURCE.includes('candidateBasisLimitation'), 'sample.candidateBasisLimitation field must exist on the M2 report');
  assert.ok(SOURCE.includes('BH-014'), 'the limitation text must reference BH-014 so it stays traceable to the audit finding');
  assert.match(SOURCE, /Limitation \(BH-014\)/, 'the Markdown header must render the limitation prominently');
});

console.log('\nbh-w2-smallcap: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
