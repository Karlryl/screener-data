'use strict';
// Untangle finding F002 (13.11.2026): the share-count deadline report must surface in the daily run (GitHub warning and
// step summary), never stop it, and never be an all-clear when its input is missing.
// Run: node tests/handtabellen-fristen-melden.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'handtabellen-fristen-melden.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fristen-melden-'));

function run(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('a withholdUnverified row inside the window becomes a GitHub warning naming firm, deadline and board', () => {
  const tabelle = { ACME: { withholdUnverified: true, reviewBy: '2026-11-30' }, KEEP: { reviewBy: '2027-06-30' }, _holds: {} };
  const universum = { rows: [{ t: 'ACME', n: 'Acme Corp', b: 'energy', rk: 7, mc: 5e9 }, { t: 'KEEP', n: 'Keep AG', b: null, rk: null, mc: 1e9 }] };
  fs.writeFileSync(path.join(tmp, 't.json'), JSON.stringify(tabelle)); fs.writeFileSync(path.join(tmp, 'u.json'), JSON.stringify(universum));
  const r = run(['--tabelle', path.join(tmp, 't.json'), '--universum', path.join(tmp, 'u.json'), '--datum', '2026-11-13']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^::warning title=Handtabelle Fristen::Frist 30\.11\.2026 \(in 17 Tagen\).*Acme Corp \(ACME; Energie Rang 7; fällt vom Board/m);
  assert.doesNotMatch(r.out, /KEEP/);
});

test('the committed table: the three rows of 30.11.2026 are reported on data day 13.11.2026', () => {
  const universum = { rows: ['3018.TW', '7911.T', 'JOJO.BO'].map((t, i) => ({ t, n: 'Firm ' + t, b: 'industrials', rk: i + 1, mc: 1e9 })) };
  fs.writeFileSync(path.join(tmp, 'u2.json'), JSON.stringify(universum));
  const r = run(['--universum', path.join(tmp, 'u2.json')], { RUN_DATE_UTC: '2026-11-13' });
  assert.equal(r.code, 0);
  const line = r.out.split('\n').find(l => l.includes('Frist 30.11.2026'));
  assert.ok(line && line.startsWith('::warning'), r.out);
  for (const t of ['3018.TW', '7911.T', 'JOJO.BO']) assert.ok(line.includes(t), t);
});

test('a missing filter feed is named as not checkable, exit 0, no all-clear', () => {
  const r = run(['--universum', path.join(tmp, 'fehlt.json'), '--datum', '2026-11-13']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^::warning title=Handtabelle Fristen::Die Fristen der Aktienzahl-Handtabelle sind heute nicht prüfbar .*keine Entwarnung\.$/m);
  assert.doesNotMatch(r.out, /Keine Frist/);
});

test('the scoring job runs the report after the filter universe and before the deploy, and it can never fail the run', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8').replace(/\r\n/g, '\n');
  const scoring = yml.slice(yml.indexOf('\n  scoring:\n'), yml.indexOf('\n  druckenmiller-guard:\n'));
  const iFilter = scoring.indexOf('- name: Build and check filter universe');
  const iStep = scoring.indexOf('node scripts/handtabellen-fristen-melden.js');
  const iDeploy = scoring.indexOf('- name: Deploy Scoring Output to GitHub Pages');
  assert.ok(iFilter >= 0 && iStep > iFilter && iStep < iDeploy, `order filter=${iFilter} report=${iStep} deploy=${iDeploy}`);
  const stepStart = scoring.lastIndexOf('\n      - name:', iStep);
  const step = scoring.slice(stepStart, scoring.indexOf('\n      - name:', iStep));
  assert.match(step, /continue-on-error: true/);
});
