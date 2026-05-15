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

if (!fs.existsSync(HEALTH_DIR)) {
  console.log('No pipeline-health/ directory — scripts did not run or were empty');
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
