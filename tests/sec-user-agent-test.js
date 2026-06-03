#!/usr/bin/env node
/**
 * Regression guard: every SEC-EDGAR-pulling script MUST send a User-Agent that
 * carries a real contact (an email address), per SEC's EDGAR Terms of Use.
 *
 * Why this exists: SEC silently serves HTTP 403 to contactless User-Agents.
 * Tag 211j fixed this in pull-insider-form4.js and pull-13f-institutional.js
 * but MISSED pull-sec-xbrl.js — which kept the contactless
 * 'screener-data/1.0 (github.com/...)' UA and so returned err=51/pulled=0 on
 * every monthly run (the 51-error abort gate tripping on 51 consecutive 403s)
 * until the 2026-06 fix. This test makes that whole class of regression loud
 * and fast: a contactless UA fails here in milliseconds instead of after a
 * 403 storm in CI.
 *
 * Offline — pure static source inspection, no network.
 *
 * Run:
 *   node tests/sec-user-agent-test.js
 *
 * Exits non-zero on any violation (CI-friendly).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// All scripts that hit *.sec.gov. Add new SEC pullers here.
const SEC_SCRIPTS = [
  'pull-sec-xbrl.js',
  path.join('scripts', 'pull-insider-form4.js'),
  path.join('scripts', 'pull-13f-institutional.js'),
];

// A compliant UA must contain an email-like contact. SEC's guidance is
// "Sample Company Name AdminContact@sample.com"; the operative signal is a
// reachable address, which in practice means an '@' inside the UA string.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok: ' + name);
  } else {
    failed++;
    console.log('  FAIL: ' + name + (detail ? ' — ' + detail : ''));
  }
}

for (const rel of SEC_SCRIPTS) {
  const abs = path.join(ROOT, rel);
  let src;
  try {
    src = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    check(rel + ' readable', false, e.message);
    continue;
  }
  // Pull the USER_AGENT string literal. Tolerates single or double quotes and
  // a preceding `const USER_AGENT =`.
  const m = src.match(/USER_AGENT\s*=\s*(['"])([^'"]+)\1/);
  check(rel + ' declares a USER_AGENT', !!m, 'no `const USER_AGENT = "..."` found');
  if (!m) continue;
  const ua = m[2];
  check(rel + ' UA carries a contact email', EMAIL_RE.test(ua),
    'contactless UA "' + ua + '" → SEC will 403 it');
}

if (failed > 0) {
  console.log('\nFAILED: ' + failed + ' SEC User-Agent assertion(s)');
  process.exit(1);
}
console.log('\nPASSED: all SEC scripts send a contact-bearing User-Agent');
