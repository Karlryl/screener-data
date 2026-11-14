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

test('the committed table: every withholdUnverified row of the next deadline is reported as a warning (default inputs)', () => {
  // Derived from the table, so re-verifying a row (new reviewBy) does not break the test. On 13.11.2026 this is
  // 3018.TW, 7911.T and JOJO.BO with reviewBy 30.11.2026.
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'configs', 'share-count-hand-table.json'), 'utf8'));
  const rows = Object.entries(table).filter(([k, v]) => !k.startsWith('_') && v && v.withholdUnverified === true && /^\d{4}-\d{2}-\d{2}$/.test(v.reviewBy || ''));
  if (!rows.length) return; // no such row left: nothing can expire
  const next = rows.map(([, v]) => v.reviewBy).sort()[0];
  const due = rows.filter(([, v]) => v.reviewBy === next).map(([t]) => t);
  const datum = new Date(Date.parse(next + 'T00:00:00Z') - 10 * 86400000).toISOString().slice(0, 10);
  const universum = { rows: due.map((t, i) => ({ t, n: 'Firm ' + t, b: 'industrials', rk: i + 1, mc: 1e9 })) };
  fs.writeFileSync(path.join(tmp, 'u2.json'), JSON.stringify(universum));
  const r = run(['--universum', path.join(tmp, 'u2.json')], { RUN_DATE_UTC: datum });
  assert.equal(r.code, 0);
  const tag = next.split('-').reverse().join('.');
  const line = r.out.split('\n').find(l => l.includes(`Frist ${tag} (in 10 Tagen)`));
  assert.ok(line && line.startsWith('::warning'), r.out);
  for (const t of due) assert.ok(line.includes(t), t);
});

test('a missing filter feed is named as not checkable, exit 0, no all-clear', () => {
  const r = run(['--universum', path.join(tmp, 'fehlt.json'), '--datum', '2026-11-13']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^::warning title=Handtabelle Fristen::Die Fristen der Aktienzahl-Handtabelle sind heute nicht prüfbar .*keine Entwarnung\.$/m);
  assert.doesNotMatch(r.out, /Keine Frist/);
});

test('valid JSON with the wrong shape is named as not checkable, never as "no deadline"', () => {
  fs.writeFileSync(path.join(tmp, 'u3.json'), JSON.stringify({ rows: [] }));
  for (const [name, table] of [['null', null], ['array', []], ['primitive-row', { ACME: 5 }], ['bad-holds', { _holds: [] }]]) {
    fs.writeFileSync(path.join(tmp, `t-${name}.json`), JSON.stringify(table));
    const r = run(['--tabelle', path.join(tmp, `t-${name}.json`), '--universum', path.join(tmp, 'u3.json'), '--datum', '2026-11-13']);
    assert.equal(r.code, 0, name);
    assert.match(r.out, /nicht prüfbar .*keine Entwarnung/, name);
    assert.doesNotMatch(r.out, /Keine Frist/, name);
  }
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
  // A hanging report must not eat the job's time budget before the deploy (Codex review round 1).
  const limit = /timeout-minutes: (\d+)/.exec(step);
  assert.ok(limit && Number(limit[1]) <= 5, 'the step has its own short timeout');
});
