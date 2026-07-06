#!/usr/bin/env node
// Frage 11 two-stage coverage gate. Design: see 'Verify Pull Coverage (two-stage)'
// step in .github/workflows/daily-pull.yml.
//
// Outcomes:
//   KATASTROPHAL -> exit 1 (blocks deploy; Deploy step is `if: success()`)
//   DEGRADIERT   -> exit 0, deploy, marker+::error::/::warning:: (banner shows)
//   OK           -> exit 0, deploy, marker (banner hidden)
//
// Always writes outputs/coverage-status.json — the machine-readable flag that
// findash-export v1 (task 1.1) reads to render the dashboard degradation banner.
// NOTE: outputs/ is .gitignored (repo convention: committed via gh-pages only).
// This file is therefore DEPLOY-ONLY: the workflow's Deploy step copies the
// working-tree outputs/. into _site/outputs/, so the marker lands on gh-pages.
// It is NOT committed to main — the export must read it from the gh-pages URL.
// Signal path is red-X + this marker only (no mail/Discord).
const fs = require('fs');
const path = require('path');

const SNAP_DIR = './snapshots';
const MANIFEST = path.join(SNAP_DIR, '_manifest.json');
const WATCHLIST = './watchlist.json';
const MARKER = './outputs/coverage-status.json';

// Thresholds — see workflow comment for rationale. HARD_FLOOR is the UNCHANGED
// current gate value (not lowered); SOFT_TARGET detects degradation only.
const HARD_ABS = 2500, HARD_PCT = 0.13;   // katastrophal floor = max(2500, 13%)
const SOFT_ABS = 4600, SOFT_PCT = 0.18;   // full-pull target  = max(4600, 18%)
const FAIL_MASS_MAX = 0.35;               // n_failed/(n_ok+n_failed) above this = degraded

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function watchlistSize() {
  const w = readJSON(WATCHLIST);
  if (!w) return 0;
  if (Array.isArray(w)) return w.length;
  if (Array.isArray(w.stocks)) return w.stocks.length;   // current wrapped schema
  return Object.keys(w).length;                          // legacy
}
function fileCount() {
  try { return fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && f !== '_manifest.json').length; }
  catch (e) { return 0; }
}

// Pure classifier — unit-testable. Returns {status, reasons[], n_ok, n_total, source}.
function classify(m, wlSize, fCount) {
  const reasons = [];
  if (!m || !(m.n_ok > 0)) {
    // schema-broken / no usable manifest: fall back to on-disk file count (as old step did)
    const ok = fCount, total = wlSize > 0 ? wlSize : fCount, source = 'file-count/watchlist-denom';
    const hard = Math.max(HARD_ABS, Math.floor(total * HARD_PCT));
    if (!(ok > 0) || ok < hard) {
      reasons.push(!m ? 'manifest-unreadable-or-missing (schema-broken)' : 'n_ok==0 in manifest');
      if (ok < hard) reasons.push(`n_ok ${ok} < HARD_FLOOR ${hard}`);
      return { status: 'katastrophal', reasons, n_ok: ok, n_total: total, source };
    }
    return finishGood(ok, total, source, m, reasons);
  }
  return finishGood(m.n_ok, m.n_total || wlSize || fCount, 'manifest', m, reasons);
}
function finishGood(ok, total, source, m, reasons) {
  const hard = Math.max(HARD_ABS, Math.floor(total * HARD_PCT));
  const soft = Math.max(SOFT_ABS, Math.floor(total * SOFT_PCT));
  if (ok < hard) {
    reasons.push(`n_ok ${ok} < HARD_FLOOR ${hard} (13% of ${total}, floor 2500)`);
    return { status: 'katastrophal', reasons, n_ok: ok, n_total: total, source };
  }
  // Passed the hard floor. Is it a clean, complete, healthy pull?
  if (m && m.partial === true) reasons.push('manifest partial=true (pull killed mid-flight)');
  if (ok < soft) reasons.push(`n_ok ${ok} < SOFT_TARGET ${soft} (18% of ${total}) — short of a full pull`);
  const nf = (m && m.n_failed) || 0;
  const denom = ok + nf;
  if (denom > 0 && nf / denom > FAIL_MASS_MAX)
    reasons.push(`failure-mass ${(nf / denom * 100).toFixed(0)}% > ${FAIL_MASS_MAX * 100}% (adapter/field mass-failure)`);
  const status = reasons.length ? 'degradiert' : 'ok';
  return { status, reasons, n_ok: ok, n_total: total, source };
}

function run() {
  const m = readJSON(MANIFEST);
  const res = classify(m, watchlistSize(), fileCount());
  const coveragePct = res.n_total > 0 ? +(res.n_ok / res.n_total * 100).toFixed(1) : 0;
  // findash-export v1 contract: `degraded` is the boolean the dashboard binds to;
  // `status`/`reasons` drive banner text.
  const marker = {
    schema: 'coverage-status/v1',
    generated_at: new Date().toISOString(),
    run_id: process.env.GITHUB_RUN_ID || null,
    status: res.status,                 // 'ok' | 'degradiert' | 'katastrophal'
    degraded: res.status !== 'ok',      // dashboard banner on/off
    blocked: res.status === 'katastrophal',
    n_ok: res.n_ok,
    n_total: res.n_total,
    coverage_pct: coveragePct,
    source: res.source,
    reasons: res.reasons,
    manifest_partial: !!(m && m.partial === true)
  };
  try {
    fs.mkdirSync(path.dirname(MARKER), { recursive: true });
    fs.writeFileSync(MARKER, JSON.stringify(marker, null, 2));
  } catch (e) { console.error(`::warning::could not write ${MARKER}: ${e.message}`); }

  // TASK 0.9 (Pull-Diät): surface the full/price-only split so a Voll-Universum-Lauf
  // reports the mix in the coverage-step log even on a partial (timeout) run — the number
  // FUNDAMENTALS_REFRESH_BUDGET is tuned against.
  const mix = (m && (Number.isFinite(m.n_full) || Number.isFinite(m.n_price_only)))
    ? ` full=${m.n_full == null ? '?' : m.n_full} price-only=${m.n_price_only == null ? '?' : m.n_price_only}`
    : '';
  const line = `Coverage: ${res.n_ok}/${res.n_total} (${coveragePct}%)${mix} status=${res.status} source=${res.source}`;
  if (res.status === 'katastrophal') {
    console.error(`::error::KATASTROPHAL — ${line}. ${res.reasons.join('; ')}. Blocking deploy.`);
    process.exit(1);
  }
  if (res.status === 'degradiert') {
    console.error(`::error::DEGRADIERT — ${line}. ${res.reasons.join('; ')}. Deploying WITH degradation flag.`);
    console.log(`::warning::Coverage degraded — dashboard banner will show. See outputs/coverage-status.json.`);
    process.exit(0);
  }
  console.log(`OK — ${line}. Banner hidden.`);
  process.exit(0);
}

// --- runnable self-check: node scripts/coverage-gate.js --selftest ---
function selftest() {
  const N = 30228;
  const cases = [
    [{ n_ok: Math.floor(N * 0.12), n_total: N, partial: true }, 'katastrophal'],   // 12% timeout must block
    [null, 'katastrophal'],                                                        // no manifest (schema-broken proxy)
    [{ n_ok: 6000, n_total: N, partial: true }, 'degradiert'],                     // above floor but partial
    [{ n_ok: 4200, n_total: N, partial: false }, 'degradiert'],                    // above floor, below 18% soft
    [{ n_ok: 6500, n_total: N, partial: false, n_failed: 100 }, 'ok'],             // clean full healthy pull
    [{ n_ok: 6000, n_total: N, partial: false, n_failed: 5000 }, 'degradiert'],    // huge failure-mass
  ];
  let pass = 0;
  for (const [m, want] of cases) {
    const got = classify(m, N, 0).status;   // null case: 0 files -> file-count fallback also fails -> katastrophal
    const ok = got === want;
    console.log(`${ok ? 'PASS' : 'FAIL'}  want=${want} got=${got}  ${JSON.stringify(m)}`);
    if (ok) pass++;
  }
  console.log(`${pass}/${cases.length} passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--selftest')) selftest();
else run();
