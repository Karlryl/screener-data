'use strict';
// The public repository got a fresh history on 13.10.2026; the entry events of the registration changelog come from the archive file
// next to it. These checks pin that the archive is read, belongs to this changelog, and fails loudly when it is foreign or broken.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const stamp = require('../../lib/druckenmiller/stamp.js');
const REPO = path.resolve(__dirname, '..', '..');
const CHANGELOG_REL = 'tests/druckenmiller/fixtures/registration.CHANGELOG.md';

test('archive: every archived digest is a line of the changelog and entered before the move', () => {
  const text = fs.readFileSync(path.join(REPO, CHANGELOG_REL), 'utf8');
  const archiv = stamp.archivedEntryEvents(REPO, CHANGELOG_REL);
  assert.ok(archiv.size >= 1, 'no archived events read');
  for (const [digest, ereignisse] of archiv) {
    assert.ok(text.includes(digest) || ereignisse.some(e => e.kind === 'del'), digest + ' not in the changelog');
    assert.ok(ereignisse[0].kind === 'add' && ereignisse[0].ms < Date.parse('2026-10-13T00:00:00Z'), digest);
  }
});

test('archive: missing file means no events; a foreign or broken file throws (break once in a temp copy)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-archive-'));
  try {
    const rel = 'x/registration.CHANGELOG.md', ziel = path.join(tmp, 'x');
    fs.mkdirSync(ziel);
    assert.equal(stamp.archivedEntryEvents(tmp, rel).size, 0);
    fs.writeFileSync(path.join(ziel, 'registration.CHANGELOG.entry-archive.json'), JSON.stringify({ schema: 'stamp-entry-archive/v1', changelog: 'other.md', events: {} }));
    assert.throws(() => stamp.archivedEntryEvents(tmp, rel), /passt nicht/);
    fs.writeFileSync(path.join(ziel, 'registration.CHANGELOG.entry-archive.json'), JSON.stringify({ schema: 'stamp-entry-archive/v1', changelog: rel, events: { ['a'.repeat(64)]: [{ at: 'kaputt', kind: 'add' }] } }));
    assert.throws(() => stamp.archivedEntryEvents(tmp, rel), /unlesbar/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
