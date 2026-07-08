#!/usr/bin/env node
'use strict';
// TASK 0.10 (Schutz-Kadenzen) — Dead-Man-Marker-Stempel.
// Aktualisiert GENAU EIN Feld (last_weekly_run | last_monthly_run) in state/cadence-heartbeat.json
// auf jetzt (ISO-UTC) und laesst alle anderen Felder unangetastet (Read-Modify-Write).
// Der git commit/push passiert im Workflow-YAML (mit rebase-retry + main-push-concurrency),
// NICHT hier — dieses Skript ist reine, testbare Datei-Logik.
//
// Usage: node scripts/cadence-marker.js --field weekly|monthly [--file state/cadence-heartbeat.json]
//        node scripts/cadence-marker.js --selftest
const fs = require('fs');
const path = require('path');

const FIELD_MAP = { weekly: 'last_weekly_run', monthly: 'last_monthly_run' };

// Reine Read-Modify-Write-Funktion (TDD): setzt nur das Zielfeld, erhaelt Fremdfelder.
function stampMarker(existing, field, nowIso) {
  const key = FIELD_MAP[field];
  if (!key) throw new Error(`unbekanntes --field "${field}" (erwartet weekly|monthly)`);
  const base = (existing && typeof existing === 'object') ? existing : {};
  return Object.assign({}, base, { schema: base.schema || 'cadence-heartbeat/v1', [key]: nowIso });
}

function run() {
  const argv = process.argv;
  const get = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
  const field = get('--field', '');
  const file = get('--file', path.join('state', 'cadence-heartbeat.json'));
  if (!FIELD_MAP[field]) {
    console.error(`::error::cadence-marker — --field muss weekly oder monthly sein (war: "${field}")`);
    process.exit(1);
  }
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.warn(`cadence-marker — ${file} nicht lesbar (${e.message}), lege neu an`); }
  const updated = stampMarker(existing, field, new Date().toISOString());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(updated, null, 2) + '\n');
  console.log(`cadence-marker: ${FIELD_MAP[field]}=${updated[FIELD_MAP[field]]} -> ${file}`);
  process.exit(0);
}

function selftest() {
  const assert = require('node:assert/strict');
  let pass = 0, fail = 0;
  const t = (n, fn) => { try { fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.error('FAIL   ' + n + '\n       ' + e.message); } };

  t('stempelt weekly, laesst monthly + Fremdfeld stehen', () => {
    const before = { schema: 'cadence-heartbeat/v1', last_weekly_run: null, last_monthly_run: '2026-06-01T00:00:00.000Z', fremd: 42 };
    const after = stampMarker(before, 'weekly', '2026-07-08T05:23:00.000Z');
    assert.equal(after.last_weekly_run, '2026-07-08T05:23:00.000Z');
    assert.equal(after.last_monthly_run, '2026-06-01T00:00:00.000Z', 'monthly unangetastet');
    assert.equal(after.fremd, 42, 'Fremdfeld erhalten');
  });
  t('stempelt monthly, laesst weekly stehen', () => {
    const after = stampMarker({ last_weekly_run: '2026-07-01T00:00:00.000Z' }, 'monthly', '2026-07-03T06:41:00.000Z');
    assert.equal(after.last_monthly_run, '2026-07-03T06:41:00.000Z');
    assert.equal(after.last_weekly_run, '2026-07-01T00:00:00.000Z');
  });
  t('null/fehlendes existing -> legt sauberes Objekt an', () => {
    const after = stampMarker(null, 'weekly', '2026-07-08T00:00:00.000Z');
    assert.equal(after.schema, 'cadence-heartbeat/v1');
    assert.equal(after.last_weekly_run, '2026-07-08T00:00:00.000Z');
  });
  t('unbekanntes Feld wirft', () => {
    assert.throws(() => stampMarker({}, 'daily', '2026-07-08T00:00:00.000Z'));
  });

  console.log(`\ncadence-marker selftest: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

module.exports = { stampMarker, FIELD_MAP };
if (process.argv.includes('--selftest')) selftest();
else if (require.main === module) run();
