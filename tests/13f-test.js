#!/usr/bin/env node
/**
 * Tag 212e: Standalone smoke test for scripts/pull-13f-institutional.js.
 *
 * Mirrors tests/sec-form4-test.js — own file (not tag28-tests.js) per the
 * parallel_agent_race.md rule on never touching shared test registries.
 *
 * What it covers (all offline, no network):
 *   1. padCik() produces 10-digit zero-padded CIK strings from various inputs.
 *   2. parse13fXml() extracts ≥3 positions from a hand-crafted minimal
 *      information_table.xml and respects namespace-prefix tolerance.
 *   3. Cache-staleness gate: institutions cached < max-age are skipped, ones
 *      cached > max-age are not (simulated by checking the inline TTL math
 *      against a synthetic byInstitution map).
 *   4. parseArgs() handles --cik-list and --max-age-days in both `--k v`
 *      and `--k=v` forms.
 *
 * Run:
 *   & "C:\Program Files\nodejs\node.exe" tests/13f-test.js
 */
'use strict';

const path = require('path');
const mod = require(path.join(__dirname, '..', 'scripts', 'pull-13f-institutional.js'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('  FAIL: ' + msg); }
  else { console.log('  ok: ' + msg); }
}

// ─── 1. padCik ──────────────────────────────────────────────────────────
console.log('# 1. padCik');
assert(mod.padCik('1067983') === '0001067983', "padCik('1067983') → '0001067983'");
assert(mod.padCik('0001067983') === '0001067983', "padCik('0001067983') already padded");
assert(mod.padCik(320193) === '0000320193', 'padCik(numeric) works');
assert(mod.padCik('CIK0001067983') === '0001067983', 'padCik strips non-digits');
assert(mod.padCik('') === '0000000000', "padCik('') → all zeros (defensive)");
assert(mod.padCik(null) === '0000000000', 'padCik(null) → all zeros');

// ─── 2. parse13fXml ─────────────────────────────────────────────────────
console.log('# 2. parse13fXml');
// Hand-crafted three-position 13F info table. Mix of MSFT (SH), AAPL (SH),
// and a put on TSLA. Namespace prefix on AAPL's <infoTable> to verify
// the namespace-tolerant regex.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>MICROSOFT CORP</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>594918104</cusip>
    <value>123456</value>
    <shrsOrPrnAmt>
      <sshPrnamt>1000</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
  </infoTable>
  <ns1:infoTable>
    <ns1:nameOfIssuer>APPLE INC</ns1:nameOfIssuer>
    <ns1:titleOfClass>COM</ns1:titleOfClass>
    <ns1:cusip>037833100</ns1:cusip>
    <ns1:value>789012</ns1:value>
    <ns1:shrsOrPrnAmt>
      <ns1:sshPrnamt>2500</ns1:sshPrnamt>
      <ns1:sshPrnamtType>SH</ns1:sshPrnamtType>
    </ns1:shrsOrPrnAmt>
    <ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion>
  </ns1:infoTable>
  <infoTable>
    <nameOfIssuer>TESLA INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>88160R101</cusip>
    <value>50000</value>
    <shrsOrPrnAmt>
      <sshPrnamt>500</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
    <putCall>Put</putCall>
    <investmentDiscretion>SOLE</investmentDiscretion>
  </infoTable>
  <infoTable>
    <!-- Missing cusip — should be skipped. -->
    <nameOfIssuer>JUNK ENTRY</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <value>1</value>
    <shrsOrPrnAmt><sshPrnamt>1</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

const positions = mod.parse13fXml(SAMPLE_XML);
assert(Array.isArray(positions), 'parse13fXml returns array');
assert(positions.length === 3, 'extracts 3 valid positions, drops junk (got ' + positions.length + ')');
if (positions.length === 3) {
  const msft = positions.find(p => p.nameOfIssuer === 'MICROSOFT CORP');
  const aapl = positions.find(p => p.nameOfIssuer === 'APPLE INC');
  const tsla = positions.find(p => p.nameOfIssuer === 'TESLA INC');
  assert(!!msft, 'MSFT position present');
  assert(!!aapl, 'AAPL position present (namespace-prefixed tags parsed)');
  assert(!!tsla, 'TSLA position present');
  if (msft) {
    assert(msft.cusip === '594918104', 'MSFT cusip extracted');
    assert(msft.value === 123456, 'MSFT value (thousands USD) extracted');
    assert(msft.sshPrnamt === 1000, 'MSFT shares extracted');
    assert(msft.sshPrnamtType === 'SH', 'MSFT shareType extracted');
  }
  if (aapl) {
    assert(aapl.cusip === '037833100', 'AAPL cusip extracted from ns-prefixed XML');
    assert(aapl.sshPrnamt === 2500, 'AAPL shares extracted from ns-prefixed XML');
  }
  if (tsla) {
    assert(tsla.putCall === 'Put', 'TSLA putCall=Put extracted');
  }
}

console.log('# 2b. parse13fXml on empty/malformed input');
assert(mod.parse13fXml('').length === 0, "empty string → []");
assert(mod.parse13fXml('<not><a>13f</a></not>').length === 0, 'unrelated XML → []');
assert(mod.parse13fXml(null).length === 0, 'null → []');

// ─── 3. Cache-staleness gate logic (replicates the inline check) ────────
console.log('# 3. Cache-staleness gate');
const now = Date.now();
const FRESH_AGE_MS = 50 * 86400000;   // 50 days
const STALE_AGE_MS = 150 * 86400000;  // 150 days
const MAX_AGE_MS = 100 * 86400000;    // 100 days = default
const freshEntry = { fetchedAt: new Date(now - FRESH_AGE_MS).toISOString() };
const staleEntry = { fetchedAt: new Date(now - STALE_AGE_MS).toISOString() };
const noEntry = null;

function shouldSkip(prev, maxAgeMs) {
  return !!(prev && prev.fetchedAt &&
    (Date.now() - new Date(prev.fetchedAt).getTime()) < maxAgeMs);
}
assert(shouldSkip(freshEntry, MAX_AGE_MS) === true,
  '50-day-old entry skipped under 100-day TTL');
assert(shouldSkip(staleEntry, MAX_AGE_MS) === false,
  '150-day-old entry NOT skipped under 100-day TTL');
assert(shouldSkip(noEntry, MAX_AGE_MS) === false,
  'no prior entry NOT skipped');
// Edge: failedAt-only entry (Tag 211j pattern) should NOT be skipped because
// it has no fetchedAt → next run retries.
const failedOnly = { failedAt: new Date(now - FRESH_AGE_MS).toISOString() };
assert(shouldSkip(failedOnly, MAX_AGE_MS) === false,
  'failedAt-only entry retried on next run (Tag 211j gate)');

// ─── 4. parseArgs ───────────────────────────────────────────────────────
console.log('# 4. parseArgs');
const a1 = mod.parseArgs(['node', 'script.js', '--cik-list', '0001067983,0001364742']);
assert(Array.isArray(a1.cikList) && a1.cikList.length === 2,
  '--cik-list (space form) parses 2 CIKs');
assert(a1.cikList[0] === '0001067983', 'first CIK == 0001067983');
const a2 = mod.parseArgs(['node', 'script.js', '--cik-list=0000320193']);
assert(a2.cikList && a2.cikList.length === 1 && a2.cikList[0] === '0000320193',
  '--cik-list=v (equals form) parses');
const a3 = mod.parseArgs(['node', 'script.js', '--max-age-days', '7']);
assert(a3.maxAgeDays === 7, '--max-age-days 7 parsed (got ' + a3.maxAgeDays + ')');
const a4 = mod.parseArgs(['node', 'script.js', '--max-age-days=30']);
assert(a4.maxAgeDays === 30, '--max-age-days=30 parsed');
const a5 = mod.parseArgs(['node', 'script.js']);
assert(a5.cikList === null, 'no --cik-list → null (use bootstrap list)');
assert(a5.maxAgeDays === 100, 'default --max-age-days is 100');

// ─── 5. buildByTickerView (sanity) ──────────────────────────────────────
console.log('# 5. buildByTickerView');
const synthCache = {
  byInstitution: {
    '0001067983': {
      cik: '0001067983',
      name: 'Berkshire Hathaway Inc',
      filingDate: '2026-02-14',
      positions: [
        { nameOfIssuer: 'APPLE INC', cusip: '037833100', value: 100000, sshPrnamt: 500, sshPrnamtType: 'SH' },
        { nameOfIssuer: 'COCA COLA CO', cusip: '191216100', value: 25000, sshPrnamt: 400, sshPrnamtType: 'SH' }
      ]
    },
    '0001364742': {
      cik: '0001364742',
      name: 'BlackRock Inc',
      filingDate: '2026-02-14',
      positions: [
        { nameOfIssuer: 'APPLE INC', cusip: '037833100', value: 500000, sshPrnamt: 2500, sshPrnamtType: 'SH' }
      ]
    }
  }
};
const view = mod.buildByTickerView(synthCache);
assert(view.byCusip['037833100'] && view.byCusip['037833100'].holders.length === 2,
  'AAPL CUSIP has 2 holders across 2 institutions');
assert(view.byCusip['191216100'] && view.byCusip['191216100'].holders.length === 1,
  'KO CUSIP has 1 holder');
assert(view.byIssuerName['APPLE INC'] && view.byIssuerName['APPLE INC'].holders.length === 2,
  'byIssuerName grouping works');

console.log('');
if (failed > 0) {
  console.error('FAILED: ' + failed + ' assertion(s) failed');
  process.exit(1);
}
console.log('PASSED: all assertions ok');
