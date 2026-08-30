'use strict';

// The implementation pin on the R2-A1 bridge family is a CHAIN, not one record:
// v1.2.0 closure record -> comparator-defect addendum -> bound-manifest
// resolution addendum. Resolution walks it oldest to youngest and the youngest
// frozen link that names a path wins. No link is ever removed
// (SUPERSEDE_NO_DELETE), so every older pin stays checkable against its own
// point in time.
//
// N13: there is deliberately NO fallback. Both enforcers used to compare the
// live file against a value that could come out of the very run under test -
// `closure.currentImplementation[relative] || expected` in one, a hand-typed
// literal in the other. A pin that can fall back to the thing it pins is not a
// pin. A path that no frozen source names now fails loudly.
//
// Authority: protocol/early-detection/2.0.0/
// r2-a1-v120-bound-manifest-resolution-addendum-2026-08-30.json (ENTSCHIED 104).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
// The only literal in this module: the head of the chain. The head declares
// every other link, and closes the chain with itself.
const HEAD_REL = 'protocol/early-detection/2.0.0/'
  + 'r2-a1-v120-bound-manifest-resolution-addendum-2026-08-30.json';
const HEAD_STATUS = 'FROZEN_BOUND_MANIFEST_RESOLUTION_ADDENDUM';
const SHA256 = /^[0-9a-f]{64}$/;

const abs = (relative) => path.join(ROOT, ...relative.split('/'));
const readJson = (relative) => JSON.parse(fs.readFileSync(abs(relative), 'utf8'));
const sha256 = (relative) => crypto.createHash('sha256')
  .update(fs.readFileSync(abs(relative))).digest('hex');

function frozenRecord(relative, expectedStatus) {
  const record = readJson(relative);
  assert.equal(record.status, expectedStatus, `${relative} is not frozen as declared`);
  return record;
}

// Oldest -> youngest, exactly as the head record declares it.
function chain() {
  const head = frozenRecord(HEAD_REL, HEAD_STATUS);
  const links = head.pinChain;
  assert.ok(Array.isArray(links) && links.length >= 2, 'the pin chain is missing');
  assert.equal(links[links.length - 1].path, HEAD_REL,
    'the head record must close its own chain');
  return links.map((link) => {
    const record = frozenRecord(link.path, link.status);
    // M16 was: nothing ever recomputed the record hashes, so an accidental edit
    // of a frozen link went unnoticed. Every link that carries the bytes it was
    // frozen with is held against them here. The head cannot carry its own hash.
    if (link.sha256AtFreezeTime !== null) {
      assert.equal(sha256(link.path), link.sha256AtFreezeTime,
        `${link.path} moved after it was frozen`);
    }
    return { link, record };
  });
}

// The frozen source that holds the pin for one path: the youngest chain link
// that names it, otherwise the record the head names as the external holder.
// Nothing else counts, and a value that is present but not a hash is a defect,
// not an absence to be skipped over.
function resolvePin(relative) {
  let pinned = null;
  for (const { link, record } of chain()) {
    const value = (record[link.pinField] || {})[relative];
    if (value === undefined) continue;
    assert.ok(typeof value === 'string' && SHA256.test(value),
      `${link.path} pins ${relative} with something that is not a sha256`);
    pinned = value;
  }
  if (pinned === null) {
    // Four of the five bridge-family scripts were never held by this chain at
    // all - they are frozen in the D3/D6 records instead. The head names which
    // record holds which path; no hash is copied into it.
    const held = (readJson(HEAD_REL).familyPinsHeldElsewhere || {})[relative];
    assert.ok(held && held.record, `no frozen source pins ${relative}`);
    const value = (frozenRecord(held.record, held.status)[held.pinField] || {})[relative];
    assert.ok(typeof value === 'string' && SHA256.test(value),
      `${held.record} does not pin ${relative}`);
    pinned = value;
  }
  return pinned;
}

function assertPinned(relative) {
  // Resolve before hashing: an unpinned path must fail as a missing pin, not
  // as a missing file. The message is the whole point of removing the fallback.
  const pinned = resolvePin(relative);
  assert.equal(sha256(relative), pinned, relative);
}

module.exports = { HEAD_REL, chain, resolvePin, assertPinned };
