'use strict';
/**
 * BH-181/195 regression (batch w2-docs, config-file honesty fixes).
 *
 * BH-181: .claude/launch.json's "Yahoo Pull (single)" entry actually runs
 *   `npm run pull:single`, which pulls the FULL 11k+ ticker watchlist at an
 *   aggressive 100ms rate-limit into snapshots-single/ (package.json:10) — a
 *   pure fixture-honesty problem, not a code bug. The launcher label must no
 *   longer claim "single" without qualification; must still parse as valid
 *   JSON and still point at the real npm script.
 * BH-195: filter-config.json's _meta.description claimed "Edit here instead
 *   of method files" but no production code reads this file (only a backup
 *   test file references it) — editing it silently has zero effect. The
 *   description must be honest; the file must still be valid JSON with its
 *   existing schema/keys intact (no loader was added — YAGNI, nothing reads
 *   it).
 *
 * Both are doc/config-honesty fixes; the only "logic" here is that the files
 * must still parse and still carry the fields other tooling expects.
 *
 * Standalone runner (node <datei>, exit 0/1) — no network, reads the two
 * repo-local JSON files directly (hermetic: fixed repo-relative paths, no
 * external I/O).
 *
 * Run standalone: node tests/scoring/bh-w2-docs.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const REPO_ROOT = path.join(__dirname, '..', '..');

// ── BH-195: filter-config.json ──────────────────────────────────────────────
test('BH-195: filter-config.json is valid JSON and keeps its schema/values', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'filter-config.json'), 'utf8');
  const cfg = JSON.parse(raw); // throws if the honesty edit broke the JSON
  assert.equal(cfg._meta.schema, 'filter-config-v1');
  assert.equal(cfg.rule_of_40.threshold, 40);
  assert.equal(cfg.rule_of_x.threshold, 58);
  assert.deepEqual(cfg.ui.hiddenTabs, ['HG', 'QC']);
});

test('BH-195: filter-config.json description no longer claims to be a live tuning layer', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'filter-config.json'), 'utf8'));
  const desc = cfg._meta.description;
  assert.ok(!/edit here instead of method files/i.test(desc), 'must not repeat the false "edit here" claim');
  assert.ok(/no current production code reads|no effect|legacy|archived/i.test(desc), 'must disclose it is inert');
});

// ── BH-181: .claude/launch.json ─────────────────────────────────────────────
test('BH-181: .claude/launch.json is valid JSON with all 3 configurations intact', () => {
  const raw = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'launch.json'), 'utf8');
  const launch = JSON.parse(raw); // throws if the rename broke the JSON
  assert.equal(launch.configurations.length, 3);
  const names = launch.configurations.map(c => c.name);
  assert.ok(names.some(n => /normal/i.test(n)));
  assert.ok(names.some(n => /fast/i.test(n)));
});

test('BH-181: the pull:single launcher entry still targets pull:single but no longer implies a single-ticker/scratch pull', () => {
  const launch = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude', 'launch.json'), 'utf8'));
  const entry = launch.configurations.find(c => c.runtimeArgs && c.runtimeArgs.includes('pull:single'));
  assert.ok(entry, 'pull:single entry must still exist (script itself is out of this batch\'s scope)');
  assert.equal(entry.runtimeExecutable, 'npm');
  // BH-181 root cause: the OLD label was bare "Yahoo Pull (single)" with no
  // qualifier, misleading a reader into thinking it pulls one ticker. The
  // fixed label must call out that it is in fact the full universe.
  assert.ok(/full/i.test(entry.name), 'label must disclose this pulls the FULL universe');
});

console.log(`\nbh-w2-docs.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
