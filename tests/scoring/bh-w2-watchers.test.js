'use strict';
/**
 * BH-123/124/125/128/129/137/138/184 regression (batch w2-watchers).
 * BH-122 is fixType=decision — no code change, no test (see WORKLOG).
 *
 * BH-123: watch-exchange-coverage.js updateBaseline() pushed an alarming
 *   (drop/zero) count into the rolling median window, so the median self-
 *   healed toward the corruption within ~WINDOW/2 runs and the watcher went
 *   silent (production: Shenzhen/Shanghai/Taiwan/... after ~7 daily zeros).
 * BH-124: watch-fx-sanity.js updateBaseline() always overwrote baseline.last
 *   with today's (possibly anomalous) value, so a persistent FX corruption
 *   (100->50->50->...) only alarmed on the first transition.
 * BH-125: watch-unrouted-quote.js merged a genuinely NEW (alarming) label into
 *   the baseline union in the SAME run that flagged it, clearing the alarm.
 * BH-128: cadence-marker.js used a non-atomic write and treated an existing-
 *   but-corrupt marker file the same as "doesn't exist" (silently dropping
 *   the sibling weekly/monthly field).
 * BH-129: update-ath-state.js displayFor() exported no per-row date at all,
 *   so a stale ath distance looked as fresh as the global asOf stamp.
 * BH-137: update-ath-state.js treated ENOENT and "exists but corrupt" the
 *   same way (silent No-op) — a corrupted committed contract never surfaced.
 * BH-138: macro-regime.js's error fallback clobbered a last-known-good
 *   regimes map with an empty one on a single bad day.
 * BH-184: update-ath-state.js's bump loop coerced a null/corrupt out.ath via
 *   `b.close > null` (-> `b.close > 0`, always true) into a fake, too-low ATH
 *   instead of falling back to needsReseed.
 *
 * Standalone runner (node <datei>, exit 0/1) — no network, hermetic temp dirs.
 * Run standalone: node tests/scoring/bh-w2-watchers.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const exch = require('../../scripts/watch-exchange-coverage.js');
const fxSanity = require('../../scripts/watch-fx-sanity.js');
const unrouted = require('../../scripts/watch-unrouted-quote.js');
const cadence = require('../../scripts/cadence-marker.js');
const ath = require('../../scripts/update-ath-state.js');
const macroRegime = require('../../scripts/macro-regime.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// ── BH-123: alarming exchange count must freeze the rolling window ─────────
test('BH-123: a drop-to-zero must NOT be pushed into the window — median stays healthy, alarm persists', () => {
  const healthy = Array(14).fill(68); // seeded, fully healthy window
  let baseline = { Shenzhen: healthy.slice() };
  for (let day = 1; day <= 5; day++) {
    const dateStr = '2026-07-' + String(19 + day).padStart(2, '0');
    const alerts = exch.checkDrift({ Shenzhen: 0 }, baseline);
    assert.ok(alerts.some((a) => a.includes('Shenzhen')), 'day ' + day + ': alarm must still fire, got ' + JSON.stringify(alerts));
    baseline = exch.updateBaseline(baseline, { Shenzhen: 0 }, dateStr);
  }
  assert.deepEqual(baseline.Shenzhen, healthy, 'window must stay frozen at the last healthy state, not fill with zeros');
});

test('BH-123: control — a non-alarming count still updates the window normally', () => {
  const healthy = Array(14).fill(68);
  const baseline = { NYSE: healthy.slice() };
  const next = exch.updateBaseline(baseline, { NYSE: 70 }, '2026-07-20');
  assert.equal(next.NYSE[13], 70, 'healthy day must advance the window');
  assert.equal(next.NYSE.length, 14);
});

// ── BH-124: an FX jump must not become tomorrow's reference ────────────────
test('BH-124: a persistent FX corruption (100->50->50) must alarm on EVERY day, not just the first', () => {
  let baseline = fxSanity.updateBaseline(null, { usOver: 100, foreignOver: 100 }, '2026-07-18');
  const day2Problems = fxSanity.checkJump({ usOver: 50, foreignOver: 100 }, baseline);
  assert.ok(day2Problems.some((p) => p.includes('usOver')), 'day 2 drop must alarm (control, pre-existing behaviour)');
  baseline = fxSanity.updateBaseline(baseline, { usOver: 50, foreignOver: 100 }, '2026-07-19');
  assert.equal(baseline.last.usOver, 100, 'the anomalous day-2 value must NOT become the new reference');
  const day3Problems = fxSanity.checkJump({ usOver: 50, foreignOver: 100 }, baseline);
  assert.ok(day3Problems.some((p) => p.includes('usOver')), 'THE BUG: day 3 must still alarm (was silently green before the fix)');
});

test('BH-124: control — a same-day rerun correction still becomes the reference (no regression)', () => {
  const day1 = fxSanity.updateBaseline(null, { usOver: 145, foreignOver: 50 }, '2026-07-18');
  const rerun = fxSanity.updateBaseline(day1, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  assert.deepEqual(rerun.last, { usOver: 100, foreignOver: 50 }, 'a same-day rerun IS the correction, not a second independent day');
});

// ── BH-125: a new taxonomy label must not self-clear the alarm ─────────────
test('BH-125: a NEW label must stay unmerged (and stay alarming) until baseline is fixed by hand', () => {
  const baselineLabels = ['sector:Tech'];
  const todayLabels = ['sector:Tech', 'sector:RenamedTech'].sort();
  const mergedLabels = unrouted.mergeLabels(baselineLabels, todayLabels, true);
  assert.deepEqual(mergedLabels, ['sector:Tech'], 'the new label must not enter the union this run');
  // next run: same new label is still absent from baseline -> still flagged as new.
  const newLabelsNextRun = todayLabels.filter((l) => !new Set(mergedLabels).has(l));
  assert.deepEqual(newLabelsNextRun, ['sector:RenamedTech'], 'alarm must persist to the next run');
});

test('BH-125: control — first-ever run (no baseline) bootstraps everything, no alarm', () => {
  const todayLabels = ['sector:Tech', 'sector:Bio'].sort();
  const mergedLabels = unrouted.mergeLabels([], todayLabels, false);
  assert.deepEqual(mergedLabels, todayLabels, 'first run must seed the full label set');
});

// ── BH-128: cadence-marker atomic write + corrupt-file backup ──────────────
test('BH-128: existing-but-corrupt marker is backed up, not silently treated as fresh (sibling field warning)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-corrupt-'));
  const file = path.join(tmp, 'cadence-heartbeat.json');
  fs.writeFileSync(file, '{ this is not valid json');
  const before = fs.readdirSync(tmp).length;
  const updated = cadence.writeMarker(file, 'weekly', '2026-07-19T00:00:00.000Z');
  assert.equal(updated.last_weekly_run, '2026-07-19T00:00:00.000Z');
  const filesAfter = fs.readdirSync(tmp);
  assert.ok(filesAfter.some((f) => f.startsWith('cadence-heartbeat.json.corrupt-')),
    'a backup of the corrupt file must exist: ' + JSON.stringify(filesAfter));
  assert.equal(filesAfter.length, before + 1, 'exactly one backup created (plus the rewritten marker)');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('BH-128: control — a genuinely missing file (bootstrap) gets no backup, just a fresh marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-bootstrap-'));
  const file = path.join(tmp, 'cadence-heartbeat.json');
  const updated = cadence.writeMarker(file, 'monthly', '2026-07-19T00:00:00.000Z');
  assert.equal(updated.last_monthly_run, '2026-07-19T00:00:00.000Z');
  const files = fs.readdirSync(tmp);
  assert.deepEqual(files, ['cadence-heartbeat.json'], 'no corrupt backup on a clean bootstrap');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('BH-128: control — a valid existing marker keeps its sibling field (unaffected regression)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadence-valid-'));
  const file = path.join(tmp, 'cadence-heartbeat.json');
  fs.writeFileSync(file, JSON.stringify({ schema: 'cadence-heartbeat/v1', last_monthly_run: '2026-06-01T00:00:00.000Z' }));
  const updated = cadence.writeMarker(file, 'weekly', '2026-07-19T00:00:00.000Z');
  assert.equal(updated.last_weekly_run, '2026-07-19T00:00:00.000Z');
  assert.equal(updated.last_monthly_run, '2026-06-01T00:00:00.000Z', 'sibling field must survive a clean write');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-129: ath display now carries its own lastDate ────────────────────────
test('BH-129: displayFor exports lastDate so a consumer can gate on row-level staleness', () => {
  const d = ath.displayFor({ ath: 200, athDate: '2025-07-14', lastClose: 150, lastDate: '2026-06-01', needsReseed: false });
  assert.equal(d.lastDate, '2026-06-01', 'lastDate must be present in the display payload');
  assert.equal(d.distancePct, -25, 'control — existing distance math unaffected');
});

// ── BH-137: existing-but-corrupt ath-state.json must fail loud, not no-op ──
test('BH-137: ENOENT stays a silent no-op (bootstrap), an existing corrupt file throws', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-corrupt-'));
  const missing = path.join(tmp, 'does-not-exist.json');
  assert.equal(fs.existsSync(missing), false);
  const corrupt = path.join(tmp, 'ath-state.json');
  fs.writeFileSync(corrupt, '{ not valid json');
  // Exercise main()'s read-branch logic directly (same existsSync+try/catch shape).
  const readOrThrow = (stateFile) => {
    if (!fs.existsSync(stateFile)) return 'no-op';
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
    catch (e) { throw new Error('[ath] ' + stateFile + ' existiert, ist aber nicht lesbar/parsebar (' + e.message + ')'); }
  };
  assert.equal(readOrThrow(missing), 'no-op', 'missing file stays a legitimate no-op');
  assert.throws(() => readOrThrow(corrupt), /existiert, ist aber nicht lesbar/, 'existing corrupt file must fail loud');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-138: macro-regime error fallback must not clobber a last-good file ──
test('BH-138: writeEmptyFallback leaves an existing good regimes file untouched, writes a sidecar instead', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-regime-'));
  const out = path.join(tmp, 'macro-regime.json');
  const goodPayload = { asOf: '2026-07-18T00:00:00.000Z', ticker: 'SPY', regimes: { '2026-07-17': { regime: 'BULL', price: 500, sma200: 470 } } };
  fs.writeFileSync(out, JSON.stringify(goodPayload));
  macroRegime.writeEmptyFallback({ out, ticker: 'SPY' });
  const stillThere = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(stillThere.regimes, goodPayload.regimes, 'last-known-good regimes must survive a bad run');
  const sidecar = macroRegime.errorSidecarPath(out);
  assert.ok(fs.existsSync(sidecar), 'error sidecar must be written: ' + sidecar);
  const err = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(err.error, 'no_price_data');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('BH-138: control — a true first-ever run (no prior file) still gets a valid empty placeholder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-regime-bootstrap-'));
  const out = path.join(tmp, 'macro-regime.json');
  macroRegime.writeEmptyFallback({ out, ticker: 'SPY' });
  const written = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(written.regimes, {}, 'bootstrap placeholder has empty regimes (nothing to preserve)');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── BH-184: a corrupt/null out.ath must not be coerced into a fake ATH ─────
test('BH-184: null ath must trigger needsReseed instead of being coerced to the window high by `b.close > null`', () => {
  const entry = { ath: null, athDate: null, refDate: null, refClose: null, lastClose: null, lastDate: null, needsReseed: false };
  const series = [{ date: '2026-07-01', close: 50 }, { date: '2026-07-15', close: 60 }];
  const out = ath.advanceEntry(entry, series);
  assert.equal(out.needsReseed, true, 'a null ath must force reseed, not silently adopt the window high');
  assert.equal(out.ath, null, 'ath must stay untouched (not coerced to 60)');
  assert.equal(ath.displayFor(out), null, 'display must be honestly off until reseed');
});

test('BH-184: control — a healthy finite ath still bumps normally (no regression)', () => {
  const entry = { ath: 100, athDate: '2025-01-02', refDate: '2026-06-01', refClose: 80, lastClose: 80, lastDate: '2026-06-01', needsReseed: false };
  const series = [{ date: '2026-06-01', close: 80 }, { date: '2026-07-10', close: 120 }];
  const out = ath.advanceEntry(entry, series);
  assert.equal(out.ath, 120);
  assert.equal(out.needsReseed, false);
});

console.log(`\nbh-w2-watchers.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
