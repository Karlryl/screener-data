'use strict';

// PII guard (26.09.2026): this repo is PUBLIC. The SEC User-Agent contact is read only at
// runtime from process.env.SEC_CONTACT (lib/sec-user-agent.js, repo rule since 16.07.) and
// must never sit in a tracked file. tests/sec-user-agent-test.js guards the SEC pullers;
// this guard covers EVERY tracked file (reports, audits, study scripts included).
//
// Detection by sha256 fingerprint only (see KNOWN and NAME_KNOWN below). Only paths are
// ever printed.
//
// Tag 1404 (02.10.2026): the guard must pass unchanged before AND after the planned history
// rewrite that removes the address and the full name. So an exception is no longer a path
// but the sha256 of the file's exact bytes: the allowance covers only those bytes, every
// edit of an allow-listed file is red, and the rewrite re-seals these pins like every other
// sha256 seal of a file whose bytes it changes. After the rewrite the pinned files are clean
// and their entries allow nothing; they may be dropped at any time.

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

// The maintainer's full name (first + last name together; the first name alone may stay):
// only a sha256 fingerprint of the lower-cased "first last" pair and the two word lengths
// are stored. Every word pair of that shape (space, %20 or the split literal ', ' between)
// is hashed and compared.
const NAME_KNOWN = ['9b81287a4a011285fb7c835a215f6034c0f4a2394e603bd17e79bf99d493d3d2'];
const NAME_SHAPE = "[A-Za-z]{4}([ ]|%20|', ')+[A-Za-z]{7}";

function knownHashes() {
  const env = process.env.SEC_CONTACT || '';
  const fromEnv = (env.match(EMAIL) || []).filter((a) => !/@example\./i.test(a)).map(sha);
  return new Set([...KNOWN, ...fromEnv]);
}

const fileSha = (rel) => createHash('sha256').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');

// Hash-pinned files that still carry the address: [sha256 of the exact bytes, why frozen].
// Editing them breaks a verified hash or a frozen code identity; re-sealing or a history
// rewrite is Karl's call.
const FROZEN = new Map([
  ['reports/studie/f1-datenfundament-freeze-2026-08-30.json', ['6d12d3fc09876cbefa550c7aab3bb0d2905e9bf8e2de4deb57b98ebd0c0d1d53',
    'self-hash f1FreezeSha256 (58b86559...), verified by tests/studie-f1-datenfundament.test.js '
    + '(--pruefen) and cited by protocol/early-detection/2.1.0/konzeptliste.json']],
  ['scripts/studie-c0.py', ['3652bb141499b80d012c23b18e2638d14260184874f069aca8a0436bb9433043',
    'sha256 pinned in protocol/strang-c/C0-freeze1.json:10, asserted by tests/studie-c0.test.js '
    + '("FREEZE 1 versiegelt das Skript selbst"); FREEZE 2 hashes FREEZE 1']],
  ['scripts/studie-f1-freeze.py', ['c73012852649bd3ccc53933a7b4b6ed35df814b9e702a086b5dcd61846107245',
    'sha256 pinned as frozen extraction code in f1-datenfundament-freeze-2026-08-30.json:793, '
    + 'which is itself self-hashed']],
  ['scripts/studie-f1-vintage-wiederherstellung.py', ['f1e0330b72cb075362c691ac7531a51499d2382405c1e3ef31de513e6e73b869',
    'sha256 pinned as frozen extraction code in f1-datenfundament-freeze-2026-08-30.json:778, '
    + 'which is itself self-hashed']],
]);

// Sealed study artefacts (ledgers, freezes, registered scripts) that still carry the full
// name: [sha256 of the exact bytes]. Same rule as FROZEN; only the history rewrite cleans them.
const NAME_FROZEN = new Map([
  ['protocol/early-detection/2.0.0/outcome-access-ledger-teil2.json', ['05d0654b8b4541c34f79062a8d9fa7570f81713c8a587efec334498f8e82c4b3']],
  ['protocol/early-detection/2.0.0/outcome-access-ledger.json', ['ccdf9b3cc7824f563859bc93d40e1fffa11344bdcd83ac92b36b0d857a5907d5']],
  ['reports/studie/f1-datenfundament-2026-08-30.md', ['9d021a110125534c036beecbfdfc08492510c3a0bf64e28a0e3b40fb67da8de1']],
  ['reports/studie/f1-datenfundament-freeze-2026-08-30.json', ['6d12d3fc09876cbefa550c7aab3bb0d2905e9bf8e2de4deb57b98ebd0c0d1d53']],
  ['reports/studie/f1-vintage-sichtkasten-2026-08-30.json', ['a752d0159b42264de36c9544632a2d365e077e931d6dbb48b90b44206ef6df2b']],
  ['reports/studie/f1-vintage-wiederherstellung-2026-08-30.json', ['11f3380edc1f90d03d8cef7dc4816ddf01e633c78e43da5f558b1dd7d7d2732a']],
  ['scripts/studie-c0.py', ['3652bb141499b80d012c23b18e2638d14260184874f069aca8a0436bb9433043']],
  ['scripts/studie-f1-freeze.py', ['c73012852649bd3ccc53933a7b4b6ed35df814b9e702a086b5dcd61846107245']],
  ['scripts/studie-f1-vintage-wiederherstellung.py', ['f1e0330b72cb075362c691ac7531a51499d2382405c1e3ef31de513e6e73b869']],
  ['scripts/studie-f6-abschluss.js', ['1b95478115b9a1e4f21d275bc98bbab8aae481484c56cd1cd37929eb51298024']],
  ['scripts/studie-f6-aequivalenz-akt2.js', ['448ba1750aa12b9f92c79df0b21c1e4a4ed879ea8d5b8d26b2d301d35f768f16']],
  ['scripts/studie-f6-eintrag28.js', ['69333dbb0a510083ff2d7a149c72297d23cfbc415d916b771dbd971f0410298e']],
  ['scripts/studie-f6-eintrag29.js', ['c0e2edf4157192078b398f20cc63429f66a4802618fe729daa56afb79eba6105']],
  ['scripts/studie-f6-konfirmatorisch.js', ['8228cab2abb19c3c8272f4aa3168a5de36b62c33a572ee3d1855ced7de906778']],
  ['scripts/studie-f6-vorfall.js', ['77a81412f47cddc9a3305ec9ceba529c4bd43d2e5106f852485cb83fd63c7a14']],
]);

function grep(pattern) {
  // -I skips binaries; -o -z prints "path\0match" pairs; only paths are ever reported.
  const r = spawnSync('git', ['grep', '-I', '-o', '-z', '-E', pattern],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status === 1) return []; // git grep: 1 = no match
  assert.equal(r.status, 0, `git grep failed (${r.status}): ${r.stderr}`);
  return r.stdout.split('\n').map((line) => [line.slice(0, line.indexOf('\0')), line.slice(line.indexOf('\0') + 1)])
    .filter(([file]) => file.length > 0);
}

function filesContaining(hashes) {
  const hits = new Set();
  for (const [file, match] of grep('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}')) {
    if (hashes.has(sha(match))) hits.add(file);
  }
  return [...hits];
}

function filesNamingTheMaintainer() {
  const hits = new Set();
  const seen = new Map();
  for (const [file, match] of grep(NAME_SHAPE)) {
    const words = match.replace(/%20/g, ' ').match(/[A-Za-z]+/g) || [];
    const pair = words.join(' ');
    if (!seen.has(pair)) seen.set(pair, words.length === 2 && NAME_KNOWN.includes(sha(pair)));
    if (seen.get(pair)) hits.add(file);
  }
  return [...hits];
}

// An exception holds only for the exact pinned bytes.
const allowed = (list, file) => list.has(file) && fs.existsSync(path.join(REPO, file))
  && fileSha(file) === list.get(file)[0];

test('no tracked file carries the contact address (outside the byte-pinned list)', () => {
  const offenders = filesContaining(knownHashes()).filter((f) => !allowed(FROZEN, f));
  assert.deepEqual(offenders, [],
    'Contact address in tracked file(s) — replace with <SEC_CONTACT>, read it from '
    + 'process.env.SEC_CONTACT at runtime: ' + offenders.join(', '));
});

test('no tracked file carries the maintainer full name (outside the byte-pinned list)', () => {
  const offenders = filesNamingTheMaintainer().filter((f) => !allowed(NAME_FROZEN, f));
  assert.deepEqual(offenders, [], 'Full name in tracked file(s): ' + offenders.join(', '));
});

test('every allow-listed frozen file is byte-identical to its pin (no stale allow-list entries)', () => {
  const stale = [FROZEN, NAME_FROZEN].flatMap((list) => [...list.keys()].filter((f) => !allowed(list, f)));
  assert.deepEqual(stale, [], 'Edited, cleaned or gone — drop from the list (or re-seal the pin): ' + stale.join(', '));
});
