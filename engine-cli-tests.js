#!/usr/bin/env node
/**
 * engine-cli-tests.js — Pre-Pull CI gate.
 * Runs in the CI workflow before the Yahoo pull; a red gate aborts the pull.
 *
 * ADR-001 Phase 3 (2026-06-20): the Track-A/B v7.3 scoring engine + score-orchestrator
 * were retired and DELETED. This gate previously exercised those (dead) code paths.
 * It now validates what is actually LIVE: the sub-profile classifier
 * (lib/sub-profile.js — used in the production scoring path via methods/_helpers.js)
 * over the engine fixtures, plus the manipulation-filters API surface. The live
 * mode/tier scorer is covered by tag28-tests.js (fixture-hash) + the anchor tests,
 * so no scoring coverage is lost — only the dead-engine assertions are dropped.
 *
 * Run: node engine-cli-tests.js   ·   Exit 0 = all green, 1 = any fail.
 */
'use strict';

const { classifySubProfile, SUB_PROFILES } = require('./lib/sub-profile.js');
const ManipulationFilters = require('./manipulation-filters.js');
const { fixtures } = require('./engine-fixtures.js');

const c = (s, color) => process.stdout.isTTY ? `\x1b[${color}m${s}\x1b[0m` : s;
const green = s => c(s, 32), red = s => c(s, 31), gray = s => c(s, 90);

console.log('Sub-Profile Classifier — CLI Test-Runner (ADR-001 Phase 3)');
console.log(`${fixtures.length} fixtures · lib/sub-profile.js`);
console.log('─'.repeat(70));

let pass = 0, fail = 0;

fixtures.forEach((fx) => {
  const stock = fx.canonical;
  const expected = fx.expected;
  const ticker = stock.meta.ticker;
  if (!expected || !expected.subProfile) return; // fixture carries no sub-profile expectation
  let got;
  try {
    got = classifySubProfile(stock).id;
  } catch (e) {
    fail++;
    console.log(`${red('✗')} ${ticker.padEnd(8)} classifier threw: ${e.message}`);
    return;
  }
  if (got === expected.subProfile) {
    pass++;
    console.log(`${green('✓')} ${ticker.padEnd(8)} ${gray(got)}`);
  } else {
    fail++;
    console.log(`${red('✗')} ${ticker.padEnd(8)} subProfile: got ${red(got)}, want ${green(expected.subProfile)}`);
  }
});

console.log('─'.repeat(70));
console.log(`Result: ${green(pass + ' pass')} · ${fail > 0 ? red(fail + ' fail') : gray('0 fail')}`);

// API surface sanity
try {
  if (typeof classifySubProfile !== 'function') throw new Error('classifySubProfile missing');
  if (!SUB_PROFILES || !SUB_PROFILES.OTHER) throw new Error('SUB_PROFILES missing');
  console.log(green('✓') + ' sub-profile API surface intact');
} catch (e) {
  fail++;
  console.log(red('✗') + ` sub-profile API: ${e.message}`);
}

try {
  // Tag 220 (audit F-220a-01 HIGH fix): the real API is `evaluate(stock, scoreResult)`.
  if (typeof ManipulationFilters.evaluate !== 'function') {
    throw new Error('ManipulationFilters.evaluate missing');
  }
  console.log(green('✓') + ' ManipulationFilters API intact');
} catch (e) {
  fail++;
  console.log(red('✗') + ` ManipulationFilters: ${e.message}`);
}

if (fail > 0) {
  console.log('');
  console.log(red(`${fail} test(s) failed — workflow should ABORT before pull.`));
  process.exit(1);
}
console.log(green('All tests passed — safe to proceed with Yahoo-Pull.'));
process.exit(0);
