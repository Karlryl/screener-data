'use strict';

// PII guard (26.09.2026): this repo is PUBLIC. The SEC User-Agent contact is read only at
// runtime from process.env.SEC_CONTACT (lib/sec-user-agent.js, repo rule since 16.07.) and
// must never sit in a tracked file. tests/sec-user-agent-test.js guards the SEC pullers;
// this guard covers EVERY tracked file (reports, audits, study scripts included).
//
// Detection by sha256 fingerprint only (see KNOWN below). Only paths are ever printed.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const { createHash } = require('node:crypto');

// Only a sha256 fingerprint of the maintainer's lower-cased address is stored here, so this
// public file reveals nothing. Every e-mail-shaped string in every tracked file is hashed and
// compared; addresses in SEC_CONTACT (if set) are added the same way.
const sha = (s) => createHash('sha256').update(String(s).toLowerCase()).digest('hex');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KNOWN = ['828e392b518bc15feb43bff0327cf5c2f529c618be89251aa2bc82d7188dc155'];

function knownHashes() {
  const env = process.env.SEC_CONTACT || '';
  const fromEnv = (env.match(EMAIL) || []).filter((a) => !/@example\./i.test(a)).map(sha);
  return new Set([...KNOWN, ...fromEnv]);
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

function filesContaining(hashes) {
  // -I skips binaries; -o -z prints "path\0match" pairs; only paths are ever reported.
  const r = spawnSync('git', ['grep', '-I', '-o', '-z', '-E', '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status === 1) return []; // git grep: 1 = no match
  assert.equal(r.status, 0, `git grep failed (${r.status}): ${r.stderr}`);
  const hits = new Set();
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('\0');
    if (i > 0 && hashes.has(sha(line.slice(i + 1)))) hits.add(line.slice(0, i));
  }
  return [...hits];
}

test('no tracked file carries the contact address (outside the hash-pinned list)', () => {
  const offenders = filesContaining(knownHashes()).filter((f) => !FROZEN.has(f));
  assert.deepEqual(offenders, [],
    'Contact address in tracked file(s) — replace with <SEC_CONTACT>, read it from '
    + 'process.env.SEC_CONTACT at runtime: ' + offenders.join(', '));
});

test('every allow-listed frozen file still carries it (no stale allow-list entries)', () => {
  const still = new Set(filesContaining(new Set(KNOWN)));
  const stale = [...FROZEN.keys()].filter((f) => !still.has(f));
  assert.deepEqual(stale, [], 'Clean now — drop from FROZEN: ' + stale.join(', '));
});
