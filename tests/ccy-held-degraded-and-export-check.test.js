'use strict';
/**
 * Follow-up to the PSQL hold (PR 83), two gaps its blind review named:
 *  1. The export check (validateFile) must keep accepting coverage.reporting_ccy_held (a list, an overdue row, an
 *     empty list, null). Nothing pinned that: a stricter check that rejected the field would have gone unnoticed
 *     and stopped the export on the first day a firm is held.
 *  2. The coverage step as a real process on a DEGRADED day (the real days are mostly degraded; the old test ran
 *     only the healthy branch): an overdue held row changes neither exit code nor status, and the marker carries it.
 * Fixture data only; nothing live is read or written.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');
const { validateFile } = require('../scripts/write-findash-export.js');

const root = path.join(__dirname, '..');
const row = overdue => ({ ticker: 'PSQL', type: 'new-period', reason: 'USD != row EUR', owner: 'Claude-Tageslauf-Master', firstSeen: '2026-10-30', pruefungBis: '2026-11-13', overdue });
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the export check accepts coverage.reporting_ccy_held as a list, an overdue row, an empty list and null', () => {
  // The probe envelope is no board file, so validateFile always lists the board errors; the field must add nothing to them.
  const errorsOf = held => {
    const errs = [];
    const coverage = { status: 'degradiert', degraded: true, blocked: false, coverage_pct: 70 };
    validateFile({ schema: 'findash-export/v1', generated_at: '2026-11-15T10:00:00Z', coverage: held === undefined ? coverage : { ...coverage, reporting_ccy_held: held } }, 'probe', errs);
    return errs;
  };
  const baseline = errorsOf(undefined);
  assert.ok(baseline.length > 0 && baseline.every(e => !/coverage/.test(e)), 'the probe has board errors only: ' + baseline.join(' | '));
  for (const held of [[row(true)], [row(false)], [], null]) assert.deepEqual(errorsOf(held), baseline, 'the field changed the verdict for ' + JSON.stringify(held));
});

test('the export check still rejects a broken coverage block (the probe above is not blind)', () => {
  const errs = [];
  validateFile({ schema: 'findash-export/v1', generated_at: 'x', coverage: { status: 'kaputt', degraded: 'ja', blocked: false, coverage_pct: 'x', reporting_ccy_held: [row(true)] } }, 'probe', errs);
  assert.ok(errs.some(e => /coverage\.status/.test(e)) && errs.some(e => /coverage\.degraded/.test(e)) && errs.some(e => /coverage_pct/.test(e)), errs.join('\n'));
});

test('degraded day as a real process: an overdue held row changes neither exit code nor status, the marker carries it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccy-degraded-'));
  try {
    const healthy = { n_ok: 12000, n_full: 2000, n_priceonly: 10000, n_failed: 0, n_total: 15000, n_skipped_mcap: 2500, partial: true };
    const step = manifest => {
      const cwd = fs.mkdtempSync(path.join(dir, 'step-'));
      fs.mkdirSync(path.join(cwd, 'snapshots'));
      fs.writeFileSync(path.join(cwd, 'snapshots', '_manifest.json'), JSON.stringify(manifest));
      fs.writeFileSync(path.join(cwd, 'watchlist.json'), JSON.stringify({ stocks: Array.from({ length: 15000 }, (_, i) => ({ ticker: 'T' + i })) }));
      const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'coverage-gate.js')], { cwd, encoding: 'utf8' });
      return { status: r.status, marker: JSON.parse(fs.readFileSync(path.join(cwd, 'outputs', 'coverage-status.json'), 'utf8')) };
    };
    const withRow = step({ ...healthy, n_reporting_ccy_held: 1, n_reporting_ccy_conflicts: 0, n_reporting_ccy_new_periods: 1, n_reporting_ccy_overdue: 1, _reportingCcyHeld: [row(true)] });
    const without = step({ ...healthy, n_reporting_ccy_held: 0, n_reporting_ccy_conflicts: 0, n_reporting_ccy_new_periods: 0, n_reporting_ccy_overdue: 0, _reportingCcyHeld: [] });
    assert.equal(without.marker.status, 'degradiert', 'the fixture must be a degraded day, else this test checks nothing new');
    assert.equal(withRow.marker.status, 'degradiert');
    assert.equal(withRow.status, without.status);
    for (const k of ['status', 'degraded', 'blocked']) assert.equal(withRow.marker[k], without.marker[k], k);
    assert.deepEqual(withRow.marker.reasons, without.marker.reasons);
    assert.deepEqual(withRow.marker.reporting_ccy_held, [row(true)]);
    assert.equal(without.marker.reporting_ccy_held, null, 'a partial run with an empty list is unknown, never none and never a row');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

let pass = 0, fail = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
console.log(`ccy-held-degraded-and-export-check: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
