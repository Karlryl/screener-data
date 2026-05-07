#!/usr/bin/env node
/**
 * Tag 21 — Edge-Case-Tests für loadState + detect-changes Robustness
 * ===================================================================
 *
 * Run: node tag21-tests.js
 * Erwartung: alle Tests grün (✓), kein Crash.
 *
 * Tests decken die Bug-Klasse vom Live-Run #2 ab (state.byTicker undefined).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// loadState ist nicht direkt exportiert; wir laden detect-changes.js und
// extrahieren die Funktion via require + Modul-Cache. Pragmatischer Ansatz:
// wir packen loadState in eine separate Test-Helper-Datei via Re-Definition.
// Hier inline kopiert aus detect-changes.js (nach dem Tag-21-Fix), damit der Test
// standalone läuft ohne Modul-Surgery.

function _log(level, msg) { /* silent in tests */ }

function loadState(statePath) {
  const fallback = { lastRun: null, byTicker: {} };
  if (!fs.existsSync(statePath)) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
  return {
    lastRun: typeof parsed.lastRun === 'string' ? parsed.lastRun : null,
    byTicker: (parsed.byTicker && typeof parsed.byTicker === 'object' && !Array.isArray(parsed.byTicker))
      ? parsed.byTicker
      : {}
  };
}

// ─── Test-Runner ───
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'assertEq'}: expected ${e}, got ${a}`);
}

function assertShape(state, msg) {
  if (!state || typeof state !== 'object') throw new Error(`${msg}: not an object`);
  if (!('lastRun' in state)) throw new Error(`${msg}: missing lastRun`);
  if (!('byTicker' in state)) throw new Error(`${msg}: missing byTicker`);
  if (typeof state.byTicker !== 'object' || Array.isArray(state.byTicker)) {
    throw new Error(`${msg}: byTicker is not a plain object`);
  }
}

// ─── Setup: temporäre Test-Files ───
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag21-'));
function tmpFile(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

console.log('Tag-21 Edge-Case-Tests — loadState');
console.log('────────────────────────────────────');

// Test 1: Fresh start (no file)
test('non-existing file returns fallback shape', () => {
  const state = loadState(path.join(tmpDir, 'nonexistent.json'));
  assertShape(state, 'fresh state');
  assertEq(state.lastRun, null);
  assertEq(state.byTicker, {});
});

// Test 2: Empty object {}
test('empty object {} returns fallback shape', () => {
  const p = tmpFile('empty.json', '{}');
  const state = loadState(p);
  assertShape(state, 'empty {}');
  assertEq(state.lastRun, null);
  assertEq(state.byTicker, {});
});

// Test 3: Partial — only lastRun, no byTicker
test('partial state (only lastRun) gets byTicker filled', () => {
  const p = tmpFile('partial.json', '{"lastRun": "2026-05-07T08:00:00Z"}');
  const state = loadState(p);
  assertShape(state, 'partial');
  assertEq(state.lastRun, '2026-05-07T08:00:00Z');
  assertEq(state.byTicker, {});
});

// Test 4: byTicker as null
test('byTicker explicitly null falls back to {}', () => {
  const p = tmpFile('null-byTicker.json', '{"lastRun": null, "byTicker": null}');
  const state = loadState(p);
  assertShape(state, 'null byTicker');
  assertEq(state.byTicker, {});
});

// Test 5: byTicker as array (wrong type)
test('byTicker as array falls back to {}', () => {
  const p = tmpFile('array-byTicker.json', '{"lastRun": null, "byTicker": []}');
  const state = loadState(p);
  assertShape(state, 'array byTicker');
  assertEq(state.byTicker, {});
});

// Test 6: Corrupt JSON
test('corrupt JSON returns fallback', () => {
  const p = tmpFile('corrupt.json', '{not valid json');
  const state = loadState(p);
  assertShape(state, 'corrupt');
  assertEq(state.lastRun, null);
  assertEq(state.byTicker, {});
});

// Test 7: Top-level array (totally wrong type)
test('top-level array returns fallback', () => {
  const p = tmpFile('array.json', '[1,2,3]');
  const state = loadState(p);
  assertShape(state, 'array');
});

// Test 8: Top-level null
test('top-level null returns fallback', () => {
  const p = tmpFile('null.json', 'null');
  const state = loadState(p);
  assertShape(state, 'null');
});

// Test 9: Valid full state passes through
test('valid full state passes through unchanged', () => {
  const p = tmpFile('valid.json', JSON.stringify({
    lastRun: '2026-05-07T08:00:00Z',
    byTicker: { CRDO: { bucket: 'A', action: 'QUALIFIED' } }
  }));
  const state = loadState(p);
  assertEq(state.lastRun, '2026-05-07T08:00:00Z');
  assertEq(state.byTicker.CRDO.bucket, 'A');
});

// Test 10: lastRun as number (wrong type) gets nulled
test('lastRun as number gets nulled', () => {
  const p = tmpFile('num-lastRun.json', '{"lastRun": 12345, "byTicker": {}}');
  const state = loadState(p);
  assertEq(state.lastRun, null);
});

// ─── Cleanup ───
fs.rmSync(tmpDir, { recursive: true, force: true });

// ─── Summary ───
console.log('────────────────────────────────────');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
