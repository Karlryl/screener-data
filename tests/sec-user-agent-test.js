#!/usr/bin/env node
/**
 * Regression guard: every SEC-EDGAR-pulling script MUST derive its User-Agent
 * from process.env.SEC_CONTACT at runtime — and carry NO hardcoded contact.
 *
 * Two guarantees at once:
 *  1) PII (E-20260721-3): SEC's Terms require a contact email in the UA. That
 *     contact used to be hardcoded as a string literal in 11 tracked files of
 *     this PUBLIC repo (a real name + address). It now comes from
 *     process.env.SEC_CONTACT via lib/sec-user-agent.js. This guard fails loud
 *     if any SEC puller reintroduces a hardcoded real contact (example.* is a
 *     permitted placeholder, e.g. in comments).
 *  2) 403 protection: SEC silently serves HTTP 403 to contactless User-Agents.
 *     The UA must be derived from SEC_CONTACT (the helper, or process.env
 *     directly), never a contactless literal. Set SEC_CONTACT as an env var /
 *     GitHub-Actions secret at runtime.
 *
 * History: Tag 211j fixed contactless UAs in pull-insider-form4 + pull-13f but
 * missed pull-sec-xbrl → 403-storm until the 2026-06 fix; BH-037 added the daily
 * puller + backfill-form345. This test previously required a UA *literal*; since
 * E-20260721-3 it guards the env-var contract instead.
 *
 * Offline — pure static source inspection, no network.
 * Run: node tests/sec-user-agent-test.js   (exits non-zero on any violation)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// All scripts that hit *.sec.gov. Add new SEC pullers here.
const SEC_SCRIPTS = [
  'pull-sec-xbrl.js',
  path.join('scripts', 'pull-insider-form4.js'),
  path.join('scripts', 'pull-insider-form4-daily.js'),
  path.join('scripts', 'backfill-form345.js'),
  path.join('scripts', 'pull-13f-institutional.js'),
];

// Any email-like string literal in the source. example.* is a permitted
// placeholder; anything else is treated as a hardcoded real contact.
const EMAIL_LITERAL_RE = /(['"`])[^'"`\s]*@[A-Z0-9.-]+\.[A-Z]{2,}[^'"`]*\1/ig;

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

  // 1) No hardcoded real contact anywhere in the source (PII guard).
  const literals = src.match(EMAIL_LITERAL_RE) || [];
  const realContacts = literals.filter((l) => !/@example\.(com|org|net)/i.test(l));
  check(rel + ' carries no hardcoded contact email', realContacts.length === 0,
    realContacts.length ? 'found ' + realContacts[0] + ' — the contact must come from process.env.SEC_CONTACT' : '');

  // 2) The UA is derived from SEC_CONTACT (helper or process.env directly).
  const usesEnv = /secUserAgent\s*\(/.test(src) || /process\.env\.SEC_CONTACT/.test(src);
  check(rel + ' derives its User-Agent from SEC_CONTACT', usesEnv,
    'no secUserAgent()/process.env.SEC_CONTACT — set the contact via env, not code');
}

// AS-SK-001 (Hard Review 2026-07-31): the two checks above are static source
// inspection — they proved every SEC puller CAN read SEC_CONTACT, never that a
// given CI run actually HAD it set. Production run 30694660128 (01.08.2026) shows
// exactly that gap: this step reported green while the same job's Pull step sent
// an empty User-Agent and got HTTP 403 before a single ticker. In CI, also assert
// the runtime value — the whole reason this guard exists is 403 protection, and a
// static-only check cannot catch a workflow that forgot to wire the secret. Not
// enforced outside CI: a dev machine without SEC_CONTACT set must keep passing the
// local test gate (this file matches tests/*test.js).
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  try {
    require(path.join(ROOT, 'lib', 'sec-user-agent.js')).assertSecContact();
    check('SEC_CONTACT is set and contact-bearing at runtime (CI only)', true);
  } catch (e) {
    check('SEC_CONTACT is set and contact-bearing at runtime (CI only)', false, e.message);
  }
}

if (failed > 0) {
  console.log('\nFAILED: ' + failed + ' SEC User-Agent assertion(s)');
  process.exit(1);
}
console.log('\nPASSED: all SEC scripts derive their User-Agent from SEC_CONTACT (no hardcoded contact)');
