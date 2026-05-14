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

if (breached.length > 0) {
  console.error('::error::' + breached.length + ' script(s) exceeded ' + (THRESHOLD*100) + '% failure threshold');
  // Optional Discord post
  const webhook = process.env.DISCORD_WEBHOOK;
  if (webhook) {
    const msg = '⚠ Pipeline health breach:\n' + breached.map(r => `  • ${r.script}: ${(r.failure_rate*100).toFixed(2)}% failed (${r.n_failed}/${r.n_total})`).join('\n');
    fetch(webhook, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ content: msg }) })
      .catch(e => console.log('Discord post failed: ' + e.message));
  }
  process.exit(1);
}
process.exit(0);
