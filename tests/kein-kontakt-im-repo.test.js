'use strict';

// PII guard (26.09.2026): this repo is PUBLIC. The SEC User-Agent contact is read only at
// runtime from process.env.SEC_CONTACT (lib/sec-user-agent.js, repo rule since 16.07.) and
// must never sit in a tracked file. tests/sec-user-agent-test.js guards the SEC pullers;
// this guard covers EVERY tracked file (reports, audits, study scripts included).
//
// Needles: the maintainer's address prefix (built from parts, so this file never matches
// itself) plus every address found in SEC_CONTACT, if set. Only paths are ever printed.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const DEFAULT_NEEDLE = ['karl', 'viehrig@'].join('_');

function needles() {
  const env = process.env.SEC_CONTACT || '';
  const fromEnv = (env.match(/[^\s<>()"',;]+@[^\s<>()"',;]+/g) || [])
    .filter((a) => !/@example\./i.test(a));
  return [DEFAULT_NEEDLE, ...fromEnv];
}

// Hash-pinned files that still carry the address. Editing them breaks a verified hash or a
// frozen code identity; re-sealing or a history rewrite is Karl's call. Remove an entry as
// soon as its file is clean — the second test below goes red on a stale entry.
const FROZEN = new Map([
  ['reports/studie/f1-datenfundament-freeze-2026-08-30.json',
    'self-hash f1FreezeSha256 (58b86559...), verified by tests/studie-f1-datenfundament.test.js '
    + '(--pruefen) and cited by protocol/early-detection/2.1.0/konzeptliste.json'],
  ['scripts/studie-c0.py',
    'sha256 pinned in protocol/strang-c/C0-freeze1.json:10, asserted by tests/studie-c0.test.js '
    + '("FREEZE 1 versiegelt das Skript selbst"); FREEZE 2 hashes FREEZE 1'],
  ['scripts/studie-f1-freeze.py',
    'sha256 pinned as frozen extraction code in f1-datenfundament-freeze-2026-08-30.json:793, '
    + 'which is itself self-hashed'],
  ['scripts/studie-f1-vintage-wiederherstellung.py',
    'sha256 pinned as frozen extraction code in f1-datenfundament-freeze-2026-08-30.json:778, '
    + 'which is itself self-hashed'],
]);

function filesContaining(list) {
  const args = ['grep', '--null', '-l', '-i', '-F'];
  for (const n of list) args.push('-e', n);
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  if (r.status === 1) return []; // git grep: 1 = no match
  assert.equal(r.status, 0, `git grep failed (${r.status}): ${r.stderr}`);
  return r.stdout.split('\0').filter(Boolean);
}

test('no tracked file carries the contact address (outside the hash-pinned list)', () => {
  const offenders = filesContaining(needles()).filter((f) => !FROZEN.has(f));
  assert.deepEqual(offenders, [],
    'Contact address in tracked file(s) — replace with <SEC_CONTACT>, read it from '
    + 'process.env.SEC_CONTACT at runtime: ' + offenders.join(', '));
});

test('every allow-listed frozen file still carries it (no stale allow-list entries)', () => {
  const still = new Set(filesContaining([DEFAULT_NEEDLE]));
  const stale = [...FROZEN.keys()].filter((f) => !still.has(f));
  assert.deepEqual(stale, [], 'Clean now — drop from FROZEN: ' + stale.join(', '));
});
