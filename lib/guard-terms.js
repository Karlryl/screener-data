'use strict';

// Shared term list of the public-repo guards (tests/kein-kontakt-im-repo.test.js, tests/kein-signal-im-oeffentlichen-baum.test.js).
// This repo is PUBLIC: the terms are never stored in it, not even as a fingerprint. They come from two secrets with the same
// format (one term per line, at least six characters): PII_GUARD_TERMS (the maintainer's private address and full name) and
// FONDS_GUARD_TERMS (fund names). Each may be given as an environment variable (Actions secret) or, on the maintainer's machine,
// as the file named in <NAME>_FILE. Addresses in SEC_CONTACT are added, but they never arm a guard on their own. Callers print
// only paths, never a term.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SECRETS = ['PII_GUARD_TERMS', 'FONDS_GUARD_TERMS'];

// The environment variable wins; the file variant is the fallback (same order as the original PII guard).
function readSecret(name) {
  const file = process.env[name + '_FILE'];
  if (process.env[name]) return process.env[name];
  return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * Collects the guard terms: the union of PII_GUARD_TERMS and FONDS_GUARD_TERMS (environment or *_FILE) plus the addresses in
 * SEC_CONTACT, lower-cased, at least six characters, without example/invalid/test addresses.
 * @returns {string[]} Unique terms; an empty list when nothing is configured.
 */
function guardTerms() {
  const raw = SECRETS.map(readSecret).join('\n');
  const fromContact = (process.env.SEC_CONTACT || '').match(EMAIL) || [];
  return [...new Set([...raw.split(/\r?\n/), ...fromContact]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 6 && !/@example\.|\.invalid$|\.test$/.test(s)))];
}

/**
 * Tells whether a guard is armed: only an explicit secret (PII_GUARD_TERMS or FONDS_GUARD_TERMS, as variable or existing
 * *_FILE) arms it; an address in SEC_CONTACT alone is not the maintainer's data (blind review 13.10.2026).
 * @returns {boolean} True when at least one of the two secrets is present.
 */
function guardArmed() {
  return SECRETS.some((name) => Boolean(process.env[name]
    || (process.env[name + '_FILE'] && fs.existsSync(process.env[name + '_FILE']))));
}

/**
 * Lists the tracked text files of a git repository that contain one of the terms, case-insensitive, as plain text. The terms
 * go to git through a temporary file that is removed again; they never reach the output.
 * @param {string[]} terms Lower-case terms, one literal string each.
 * @param {string} [cwd] Repository to search; defaults to this repository.
 * @returns {string[]} Repository-relative paths of the offending files.
 */
function filesContaining(terms, cwd = REPO) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-guard-'));
  try {
    const list = path.join(dir, 'terms.txt');
    fs.writeFileSync(list, terms.join('\n') + '\n', { mode: 0o600 });
    const r = spawnSync('git', ['grep', '-I', '-i', '-F', '-l', '-z', '-f', list],
      { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 1) return []; // git grep: 1 = no match
    if (r.status !== 0) throw new Error(`git grep failed (${r.status})`);
    return r.stdout.split('\0').filter(Boolean);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { guardTerms, guardArmed, filesContaining };
