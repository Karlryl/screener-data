#!/usr/bin/env node
/**
 * Tag 232c-10 (audit F-SM-004 HIGH): extracted from the workflow's inline
 * `node -e "..."` so the strip step can use lib/atomic-write — the prior
 * inline path used raw fs.writeFileSync + renameSync, missing every Tag
 * 230c-1 durability guarantee (POSIX parent-dir fsync, Windows EPERM retry,
 * partial-write loop). The strip step is the LAST mutator of alert-state.json
 * before "Commit Snapshots + Alert-State", so a power-loss / SIGKILL here
 * leaves a zero-byte alert-state.json committed to main; next run hits the
 * JSON.parse fail and refuses to start (correct safety net — but rebooting
 * production state via manual revert is expensive).
 *
 * Behavior:
 *   - Reads alert-state.json; on parse failure backs up to .corrupt.<ts>.json
 *     and exits 1 (preserved from the original inline script — never silently
 *     reset to {}).
 *   - Deletes the inline `methodHistory` key (the sidecar at method-history-
 *     state.json is the canonical source — see detect-changes.js _saveMethodHistory).
 *   - Writes back atomically via writeFileAtomic.
 *   - Prints size delta for the operator (was/now bytes).
 *
 * Run from repo root: node scripts/strip-method-history.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomic-write.js');

const STATE_PATH = path.join(__dirname, '..', 'alert-state.json');

if (!fs.existsSync(STATE_PATH)) {
  console.log('alert-state.json missing — nothing to strip.');
  process.exit(0);
}

const sizeBefore = fs.statSync(STATE_PATH).size;

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
} catch (e) {
  const backup = STATE_PATH + '.corrupt.' + Date.now() + '.json';
  try { fs.copyFileSync(STATE_PATH, backup); } catch (_) {}
  console.error('::error::alert-state.json is corrupt: ' + e.message + ' (backup: ' + backup + ')');
  process.exit(1);
}

if (parsed && typeof parsed === 'object' && 'methodHistory' in parsed) {
  delete parsed.methodHistory;
}

writeFileAtomic(STATE_PATH, JSON.stringify(parsed));

const sizeAfter = fs.statSync(STATE_PATH).size;
console.log('alert-state.json stripped: ' + sizeAfter + ' bytes (was ' + sizeBefore + ' bytes)');
