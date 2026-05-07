#!/usr/bin/env node
/**
 * Tag 23 — Node-CLI Engine-Test-Suite
 * =====================================
 * Portiert engine-test.html zu Node, läuft im CI-Workflow als Pre-Pull-Step.
 * Wenn Tests rot, bricht der Workflow ab BEVOR Yahoo-Pull läuft.
 *
 * Run: node engine-cli-tests.js
 * Exit: 0 = alle grün, 1 = mind. ein Fail
 */
'use strict';

const Engine = require('./engine-v7.3.js');
const ManipulationFilters = require('./manipulation-filters.js');
const ScoreOrchestrator = require('./score-orchestrator.js');
const { fixtures, fxRates } = require('./engine-fixtures.js');

const bucketRank = (id) => ({ A: 4, B: 3, INFLECTION: 2, SPEC: 1, OUT: 0 }[id] || 0);

// ANSI colors für Terminal
const c = (s, color) => process.stdout.isTTY
  ? `\x1b[${color}m${s}\x1b[0m`
  : s;
const green = s => c(s, 32), red = s => c(s, 31), yellow = s => c(s, 33), gray = s => c(s, 90);

console.log(`v7.3 Engine — CLI Test-Runner`);
console.log(`Engine ${Engine.ENGINE_VERSION} · ${fixtures.length} Fixtures · Schema ${Engine.SCHEMA_VERSION}`);
console.log('─'.repeat(70));

let pass = 0, fail = 0;
const failures = [];

fixtures.forEach((fx, idx) => {
  const stock = fx.canonical;
  const expected = fx.expected;
  const ticker = stock.meta.ticker;
  const targetTrack = expected.track || 'A';

  let score, subProf, cross;
  try {
    score = (targetTrack === 'B')
      ? Engine.scoreTrackB(stock, { fxRates })
      : Engine.scoreTrackA(stock, { fxRates });
    subProf = Engine.classifySubProfile(stock);
    cross = Engine.isCrossProfile(stock, fxRates);
  } catch (e) {
    fail++;
    failures.push({ ticker, err: `Engine threw: ${e.message}` });
    console.log(`${red('✗')} ${ticker.padEnd(8)} ENGINE_ERROR: ${e.message}`);
    return;
  }

  const checks = [];
  checks.push({
    name: 'subProfile',
    ok: subProf.id === expected.subProfile,
    got: subProf.id, want: expected.subProfile
  });
  if (expected.bucketAtLeast && score.bucket) {
    checks.push({
      name: 'bucket',
      ok: bucketRank(score.bucket.id) >= bucketRank(expected.bucketAtLeast),
      got: score.bucket.id, want: `>=${expected.bucketAtLeast}`
    });
  }
  if (expected.actionStatus) {
    checks.push({
      name: 'actionStatus',
      ok: score.actionStatus === expected.actionStatus,
      got: score.actionStatus, want: expected.actionStatus
    });
  }
  if (expected.isCrossProfile != null) {
    checks.push({
      name: 'crossProfile',
      ok: cross === expected.isCrossProfile,
      got: String(cross), want: String(expected.isCrossProfile)
    });
  }
  if (expected.reasonCodeContains) {
    const codes = score.reasonCodes || [];
    for (const required of expected.reasonCodeContains) {
      checks.push({
        name: `reasonCode[${required}]`,
        ok: codes.includes(required),
        got: codes.join(',') || '(none)',
        want: `contains ${required}`
      });
    }
  }

  const allOk = checks.every(c => c.ok);
  if (allOk) {
    pass++;
    const score_s = score.finalScore != null ? score.finalScore.toFixed(1) : '—';
    const bucket_s = score.bucket ? score.bucket.id : '—';
    console.log(`${green('✓')} ${ticker.padEnd(8)} ${gray(subProf.id.padEnd(11))} ${gray('Track ' + score.track)} ${gray(score_s.padStart(5))} ${bucket_s}`);
  } else {
    fail++;
    failures.push({ ticker, checks: checks.filter(c => !c.ok), score, subProf });
    console.log(`${red('✗')} ${ticker.padEnd(8)} ${yellow('FAILED')}`);
    checks.filter(c => !c.ok).forEach(c => {
      console.log(`     ${red('└')} ${c.name}: got ${red(c.got)}, want ${green(c.want)}`);
    });
  }
});

console.log('─'.repeat(70));
console.log(`Result: ${green(pass + ' pass')} · ${fail > 0 ? red(fail + ' fail') : gray('0 fail')}`);

// Engine-internal sanity check: deepFreeze should work
try {
  const E = Engine;
  if (typeof E.scoreTrackA !== 'function') throw new Error('scoreTrackA missing');
  if (typeof E.scoreTrackB !== 'function') throw new Error('scoreTrackB missing');
  if (typeof E.classifySubProfile !== 'function') throw new Error('classifySubProfile missing');
  if (!E.ENGINE_VERSION) throw new Error('ENGINE_VERSION missing');
  console.log(green('✓') + ' API surface intact');
} catch (e) {
  fail++;
  console.log(red('✗') + ` API surface: ${e.message}`);
}

// Orchestrator + ManipulationFilters sanity
try {
  if (typeof ScoreOrchestrator.scoreSnapshot !== 'function') throw new Error('orchestrator.scoreSnapshot missing');
  if (typeof ScoreOrchestrator.buyStatus !== 'function') throw new Error('orchestrator.buyStatus missing');
  if (typeof ManipulationFilters.runFilters !== 'function' && typeof ManipulationFilters.applyFilters !== 'function') {
    // accept either name
    const keys = Object.keys(ManipulationFilters);
    if (!keys.length) throw new Error('ManipulationFilters empty');
  }
  console.log(green('✓') + ' Orchestrator + Filters API intact');
} catch (e) {
  fail++;
  console.log(red('✗') + ` Orchestrator/Filters: ${e.message}`);
}

if (fail > 0) {
  console.log('');
  console.log(red(`${fail} test(s) failed — workflow should ABORT before pull.`));
  process.exit(1);
}
console.log(green('All tests passed — safe to proceed with Yahoo-Pull.'));
process.exit(0);
