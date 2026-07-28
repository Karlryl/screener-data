#!/usr/bin/env node
// Tag 168: Pipeline Health Check — aggregates per-script failure rates and
// alerts via Discord if any script exceeded the 5% threshold. The scripts
// themselves don't hard-fail anymore (Tag 168 — continue-on-error: true),
// but the health check IS hard-fail so an actual systemic problem still
// blocks downstream artifacts.
'use strict';
const fs = require('fs');
const path = require('path');

const HEALTH_DIR = './pipeline-health';
const THRESHOLD = 0.05; // 5%

// F-CI-002 (Tag 193): allowlist of scripts that MUST emit a pipeline-health
// report each run. A missing file → script crashed before reaching its
// healthReport-write step → treat as 100% failure for that script. Without
// this, a generate-modes-report.js that threw on line 1 left pipeline-health
// empty and the check silently exited 0.
//
// audit/fix: EXPECTED_SCRIPTS aligned to data-only daily-pull (removed deleted scoring scripts that would synth 100% failure -> CI hard-fail)
// The hypergrowth cleanup deleted EVERY script that emitted a pipeline-health/
// report (snapshot-picks, snapshot-methods-history, generate-modes-report,
// snapshot-score-history, snapshot-r40rx-history, ...). The surviving data-only
// daily-pull steps (refresh-universe, prune-watchlist, refresh-fx,
// pull-insider-form4-daily, pull-yahoo, pull-earnings-dates,
// pull-historical-prices, macro-regime, check-pull-stats, archive-old-snapshots)
// write NO pipeline-health/*.json — their health signal lives in
// snapshots/_manifest.json, gated by the workflow's own Verify Pull Coverage /
// Verify Snapshot Freshness steps. So the allowlist MUST be empty: any entry
// here would synthesize a 100%-failure for a script that no longer emits a
// report, hard-failing the pipeline on every run. The check still does its real
// job below — it reads whatever pipeline-health/*.json reports are present and
// breaches on a >5% failure_rate — it just no longer fabricates failures for
// scripts that were deleted. Re-add an entry here only when a surviving script
// is wired to write pipeline-health/<name>.json again.
const EXPECTED_SCRIPTS = [];

const ensureDir = !fs.existsSync(HEALTH_DIR);
if (ensureDir) {
  // audit/fix: with an empty EXPECTED_SCRIPTS (data-only pipeline emits no
  // pipeline-health reports), an absent directory is no longer catastrophic —
  // it just means zero reports to aggregate. Only hard-fail on a missing dir
  // when scripts are actually expected to have written one.
  if (EXPECTED_SCRIPTS.length > 0) {
    console.error('::error::pipeline-health/ directory is missing — every emitting script crashed before writing.');
    console.error('Expected reports from: ' + EXPECTED_SCRIPTS.map(s => s.script).join(', '));
    process.exit(1);
  }
  console.log('pipeline-health/ directory absent and no scripts are expected to emit reports — nothing to check.');
  process.exit(0);
}

const files = fs.readdirSync(HEALTH_DIR).filter(f => f.endsWith('.json'));
const reports = [];
for (const f of files) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(HEALTH_DIR, f), 'utf8'));
    reports.push(r);
  } catch (e) {
    console.log('WARN: could not parse ' + f + ': ' + e.message);
  }
}

// F-CI-002: detect missing expected reports and synthesize a 100%-failure entry.
const presentScripts = new Set(reports.map(r => r && r.script).filter(Boolean));
for (const expected of EXPECTED_SCRIPTS) {
  if (!presentScripts.has(expected.script)) {
    reports.push({
      script: expected.script,
      n_total: 1,
      n_ok: 0,
      n_failed: 1,
      failure_rate: 1.0,
      _synthetic_missing: true,
      _note: 'No pipeline-health/' + expected.file + ' on disk — script crashed before writing report.'
    });
  }
}

// F-A-2026-06-21 (audit): a malformed report with a missing/non-numeric failure_rate
// made `undefined > THRESHOLD` === false and slipped through the gate. Treat a
// non-finite failure_rate as a breach (the report itself is broken).
const _isBreach = (r) => !Number.isFinite(r.failure_rate) || r.failure_rate > THRESHOLD;
const breached = reports.filter(_isBreach);
console.log('Pipeline health summary:');
for (const r of reports) {
  const marker = _isBreach(r) ? 'BREACH' : 'OK';
  console.log(`  [${marker}] ${r.script}: ${r.n_ok}/${r.n_total} (${(r.failure_rate*100).toFixed(2)}% failed)`);
}

// 29.07.: Der Discord-Versand ist raus (Karl-Freigabe). Er war nie mehr als ein
// No-Op — DISCORD_WEBHOOK war nicht gesetzt —, sah aber wie ein zweiter Alarmkanal aus.
// Der wirksame Alarm ist die ::error::-Zeile plus Exit 1: rotes X in Actions, und das
// ist der einzige Kanal, den Karl liest. Die Funktion braucht dadurch kein await mehr,
// aber der Name bleibt: sie meldet und beendet.
function _notifyAndExit() {
  if (breached.length === 0) { process.exit(0); }
  console.error('::error::' + breached.length + ' script(s) exceeded ' + (THRESHOLD * 100) + '% failure threshold');
  for (const r of breached) {
    // Die Einzelheiten gehoeren ins Protokoll, nicht in eine Nachricht, die niemand liest.
    console.error(`::error::  ${r.script}: ${(r.failure_rate * 100).toFixed(2)}% fehlgeschlagen (${r.n_failed}/${r.n_total})`);
  }
  process.exit(1);
}
_notifyAndExit();
