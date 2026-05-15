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
const EXPECTED_SCRIPTS = [
  { script: 'snapshot-picks',           file: 'snapshot-picks.json' },
  { script: 'snapshot-methods-history', file: 'snapshot-methods-history.json' },
  { script: 'generate-modes-report',    file: 'generate-modes-report.json' }
];

const ensureDir = !fs.existsSync(HEALTH_DIR);
if (ensureDir) {
  // F-CI-002: previously a missing directory exited 0. Now: dir absence
  // means ALL expected scripts failed before writing — treat as catastrophic.
  console.error('::error::pipeline-health/ directory is missing — every emitting script crashed before writing.');
  console.error('Expected reports from: ' + EXPECTED_SCRIPTS.map(s => s.script).join(', '));
  process.exit(1);
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

const breached = reports.filter(r => r.failure_rate > THRESHOLD);
console.log('Pipeline health summary:');
for (const r of reports) {
  const marker = r.failure_rate > THRESHOLD ? 'BREACH' : 'OK';
  console.log(`  [${marker}] ${r.script}: ${r.n_ok}/${r.n_total} (${(r.failure_rate*100).toFixed(2)}% failed)`);
}

async function _notifyAndExit() {
  if (breached.length === 0) { process.exit(0); }
  console.error('::error::' + breached.length + ' script(s) exceeded ' + (THRESHOLD*100) + '% failure threshold');
  const webhook = process.env.DISCORD_WEBHOOK;
  if (webhook) {
    const msg = '⚠ Pipeline health breach:\n' + breached.map(r => `  • ${r.script}: ${(r.failure_rate*100).toFixed(2)}% failed (${r.n_failed}/${r.n_total})`).join('\n');
    // F-SC-007 (Tag 181): previously the webhook was fire-and-forget — `process.exit`
    // ran before the fetch promise resolved, so the very alert this step exists to
    // surface was silently dropped. Await the fetch with a hard timeout so a hung
    // Discord doesn't block CI indefinitely.
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      await fetch(webhook, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ content: msg }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
    } catch (e) {
      console.log('Discord post failed: ' + e.message);
    }
  }
  process.exit(1);
}
_notifyAndExit();
