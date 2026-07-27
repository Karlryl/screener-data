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
// Task 0.12: die 90%-Latte der 0.2-Akzeptanz, PRÄZISIERT auf den ehrlichen Nenner
// (adressierbar = n_total − mcap-Skips; belegt-tote Ticker sind per
// data-health/dead-tickers.json bereits aus der Watchlist ausgetragen).
// Kein Relax (L6): alle bisherigen Schwellen (HARD/SOFT/FAIL_MASS) bleiben
// unverändert aktiv — die ehrliche Latte kommt ADDITIV dazu und greift nur,
// wenn das Manifest den Nenner trägt (n_addressable bzw. n_skipped_mcap).
const HONEST_TARGET = 0.90;

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
  // Task 0.12: ehrliche Coverage gegen den adressierbaren Nenner. Fallback auf
  // n_total − n_skipped_mcap für Manifeste, die n_addressable noch nicht tragen;
  // Legacy-Manifeste ganz ohne mcap-Zählung => Latte nicht messbar => kein Reason.
  let addressable = null;
  if (m && Number.isFinite(m.n_addressable) && m.n_addressable > 0) addressable = m.n_addressable;
  else if (m && Number.isFinite(m.n_skipped_mcap) && Number.isFinite(m.n_total) && m.n_total - m.n_skipped_mcap > 0)
    addressable = m.n_total - m.n_skipped_mcap;
  let honestPct = null;
  if (addressable !== null) {
    honestPct = +(ok / addressable * 100).toFixed(1);
    if (ok / addressable < HONEST_TARGET)
      reasons.push(`honest-coverage ${honestPct}% < ${HONEST_TARGET * 100}% of addressable ${addressable} (n_total − mcap-skips; Tote bereits ausgetragen, 0.12)`);
  }
  const status = reasons.length ? 'degradiert' : 'ok';
  return { status, reasons, n_ok: ok, n_total: total, source, n_addressable: addressable, honest_coverage_pct: honestPct };
}

// findash-export v1 contract (task 1.1 consumer): the dashboard binds `degraded`
// (banner on/off) and `blocked`; `status`/`reasons` drive banner text. buildMarker is
// PURE (no disk) so the selftest can assert the contract for every status class.
// Carries the 0.9 pull-mix (n_full/n_priceonly — matching pull-yahoo's manifest keys)
// through to the dashboard consumer.
function buildMarker(res, m) {
  const coveragePct = res.n_total > 0 ? +(res.n_ok / res.n_total * 100).toFixed(1) : 0;
  return {
    schema: 'coverage-status/v1',
    generated_at: new Date().toISOString(),
    run_id: process.env.GITHUB_RUN_ID || null,
    status: res.status,                 // 'ok' | 'degradiert' | 'katastrophal'
    degraded: res.status !== 'ok',      // dashboard banner on/off
    blocked: res.status === 'katastrophal',
    n_ok: res.n_ok,
    n_total: res.n_total,
    n_full: (m && Number.isFinite(m.n_full)) ? m.n_full : null,              // 0.9 instrumentation
    n_priceonly: (m && Number.isFinite(m.n_priceonly)) ? m.n_priceonly : null,
    coverage_pct: coveragePct,
    // Task 0.12: ehrlicher Nenner + ehrliche Coverage (null bei Legacy-Manifest ohne mcap-Zählung)
    n_addressable: Number.isFinite(res.n_addressable) ? res.n_addressable : null,
    honest_coverage_pct: Number.isFinite(res.honest_coverage_pct) ? res.honest_coverage_pct : null,
    // Tag 464: sichtbar machen, WARUM der Nenner kleiner ist als das Universum. Ohne diese
    // Zahl sieht man im Marker nur ein geschrumpftes n_addressable und kann nicht pruefen,
    // ob der Abzug stimmt. Nur Anzeige — die Klassifizierung liest sie nicht.
    n_skipped_mcap: (m && Number.isFinite(m.n_skipped_mcap)) ? m.n_skipped_mcap : null,
    n_skipped_owned: (m && Number.isFinite(m.n_skipped_owned)) ? m.n_skipped_owned : null,
    source: res.source,
    reasons: res.reasons,
    manifest_partial: !!(m && m.partial === true)
  };
}

// Contract guard: coverage-status.json ist Karls EINZIGER sanktionierter Alarm-Kanal
// (Dashboard-Degradiert-Banner; kein Mail/Discord). Ein stiller Schema-Bruch (fehlendes
// degraded/blocked, falscher Typ, status<->degraded/blocked-Inkonsistenz) wuerde den Banner
// lautlos abschalten -> Fail-silent statt Fail-loud. validateMarker liefert die Liste der
// Vertragsverletzungen (leer = ok); im Selftest hart gepinnt.
const VALID_STATUS = ['ok', 'degradiert', 'katastrophal'];
function validateMarker(mk) {
  if (!mk || typeof mk !== 'object') return ['marker not an object'];
  const errs = [];
  if (mk.schema !== 'coverage-status/v1') errs.push(`schema=${mk.schema}`);
  if (!VALID_STATUS.includes(mk.status)) errs.push(`status=${mk.status}`);
  if (typeof mk.degraded !== 'boolean') errs.push('degraded not boolean');
  if (typeof mk.blocked !== 'boolean') errs.push('blocked not boolean');
  if (mk.degraded !== (mk.status !== 'ok')) errs.push('degraded inconsistent with status');
  if (mk.blocked !== (mk.status === 'katastrophal')) errs.push('blocked inconsistent with status');
  for (const f of ['n_ok', 'n_total', 'coverage_pct']) {
    if (!Number.isFinite(mk[f])) errs.push(`${f} not finite`);
  }
  if (!Array.isArray(mk.reasons)) errs.push('reasons not array');
  // n_full/n_priceonly/n_addressable/honest_coverage_pct nullable (legacy manifests) but if present must be finite
  for (const f of ['n_full', 'n_priceonly', 'n_addressable', 'honest_coverage_pct', 'n_skipped_mcap', 'n_skipped_owned']) {
    if (mk[f] !== null && !Number.isFinite(mk[f])) errs.push(`${f} present but not finite`);
  }
  return errs;
}

// BH-126: fuer 'degradiert' entscheidet dies, ob trotz eines kaputten/nicht
// geschriebenen Markers noch deployt werden darf. 'katastrophal' blockt ueber
// den regulaeren exit-1-Pfad ohnehin immer, unabhaengig vom Marker. Reine
// Funktion (kein Disk-Zugriff) — selftest pinnt beide Zweige.
function degradedMarkerBroken(status, markerErrors, markerWriteFailed) {
  return status === 'degradiert' && (markerErrors.length > 0 || markerWriteFailed);
}

function run() {
  const m = readJSON(MANIFEST);
  const res = classify(m, watchlistSize(), fileCount());
  const marker = buildMarker(res, m);
  const coveragePct = marker.coverage_pct;
  const bad = validateMarker(marker);
  if (bad.length) console.error(`::warning::coverage-status marker contract violation: ${bad.join('; ')}`);
  let markerWriteFailed = false;
  try {
    fs.mkdirSync(path.dirname(MARKER), { recursive: true });
    fs.writeFileSync(MARKER, JSON.stringify(marker, null, 2));
  } catch (e) {
    markerWriteFailed = true;
    console.error(`::warning::could not write ${MARKER}: ${e.message}`);
  }

  // TASK 0.9c: surface the full/price-only split so a Voll-Universum-Lauf reports the mix
  // in the coverage-step log even on a partial (timeout) run — the number
  // FUNDAMENTALS_REFRESH_BUDGET is tuned against.
  const mix = (m && (Number.isFinite(m.n_full) || Number.isFinite(m.n_priceonly)))
    ? ` full=${m.n_full == null ? '?' : m.n_full} price-only=${m.n_priceonly == null ? '?' : m.n_priceonly}`
    : '';
  // Task 0.12: ehrliche Coverage sichtbar machen (n_ok / adressierbar)
  const honest = Number.isFinite(marker.honest_coverage_pct)
    ? ` ehrlich=${marker.n_ok}/${marker.n_addressable} (${marker.honest_coverage_pct}%)`
    : '';
  const line = `Coverage: ${res.n_ok}/${res.n_total} (${coveragePct}%)${honest}${mix} status=${res.status} source=${res.source}`;
  if (res.status === 'katastrophal') {
    console.error(`::error::KATASTROPHAL — ${line}. ${res.reasons.join('; ')}. Blocking deploy.`);
    process.exit(1);
  }
  if (res.status === 'degradiert') {
    console.error(`::error::DEGRADIERT — ${line}. ${res.reasons.join('; ')}. Deploying WITH degradation flag.`);
    // BH-126: coverage-status.json ist Karls EINZIGER Alarmkanal fuer diesen
    // Zustand. Ein kaputter Vertrag oder ein fehlgeschlagener Write duerfen
    // vorher nur ::warning:: gewesen sein und trotzdem ohne funktionierenden
    // Banner deployen. Fail loud statt blind zu deployen.
    if (degradedMarkerBroken(res.status, bad, markerWriteFailed)) {
      console.error(`::error::degradiert, aber Marker-Vertrag kaputt/nicht geschrieben (${bad.join('; ') || 'write failed'}) — Deploy blockiert, kein funktionierender Banner.`);
      process.exit(1);
    }
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
    // Task 0.12: ehrliche 90%-Latte (nur bei Manifesten mit mcap-Zählung messbar)
    [{ n_ok: 6088, n_total: 23689, partial: false, n_failed: 4209, n_skipped_mcap: 13392 }, 'degradiert'], // Ist-Zustand vor Austrag: ehrlich 59.1% < 90 (+ fail-mass)
    [{ n_ok: 6100, n_total: 20066, partial: false, n_failed: 500, n_skipped_mcap: 13392, n_addressable: 6674 }, 'ok'], // nach Austrag: ehrlich 91.4% ≥ 90
    [{ n_ok: 5500, n_total: 20066, partial: false, n_failed: 1100, n_skipped_mcap: 13392, n_addressable: 6674 }, 'degradiert'], // echter Pull-Einbruch bleibt rot: ehrlich 82.4% < 90
    // Tag 464: der reale Lauf 30230485209 MIT ehrlichem Nenner (Small-Cap-eigene Namen abgezogen).
    // 10672/12373 = 86.3% — ehrlicher als die alten 82.4%, aber weiter UNTER der 90er-Latte.
    // Der Banner bleibt also an, und das ist richtig: die Luecke sind 1678 echte Fehlschlaege.
    // Diese Zeile haelt fest, dass der Fix den Alarm NICHT stillstellt.
    [{ n_ok: 10672, n_total: 15212, partial: false, n_failed: 1678, n_skipped_mcap: 2256, n_skipped_owned: 583, n_addressable: 12373 }, 'degradiert'],
    // Und die Gegenrichtung: waeren die 1678 Fehlschlaege behoben, geht der Banner aus.
    [{ n_ok: 12000, n_total: 15212, partial: false, n_failed: 350, n_skipped_mcap: 2256, n_skipped_owned: 583, n_addressable: 12373 }, 'ok'],
  ];
  let pass = 0;
  for (const [m, want] of cases) {
    const res = classify(m, N, 0);          // null case: 0 files -> file-count fallback also fails -> katastrophal
    const got = res.status;
    const ok = got === want;
    console.log(`${ok ? 'PASS' : 'FAIL'}  want=${want} got=${got}  ${JSON.stringify(m)}`);
    if (ok) pass++;
    // Marker-Vertrag (coverage-status/v1) fuer JEDE Status-Klasse hart pinnen — schuetzt
    // Karls einzigen Alarm-Kanal vor stillem Schema-Bruch.
    const mk = buildMarker(res, m);
    const errs = validateMarker(mk);
    const okC = errs.length === 0
      && mk.degraded === (want !== 'ok')
      && mk.blocked === (want === 'katastrophal');
    console.log(`${okC ? 'PASS' : 'FAIL'}  marker-contract status=${want} degraded=${mk.degraded} blocked=${mk.blocked}${errs.length ? ' ERRS=' + errs.join(',') : ''}`);
    if (okC) pass++;
  }
  // Negativ-Kontrolle: validateMarker MUSS einen kaputten Marker fangen (sonst waere der
  // Guard wertlos). cases[2] ist 'degradiert' -> degraded MUSS true sein; wir faelschen es auf
  // false (Banner lautlos aus) und erwarten, dass der Guard das ablehnt.
  const tampered = buildMarker(classify(cases[2][0], N, 0), cases[2][0]);
  tampered.degraded = false;
  const negOk = validateMarker(tampered).length > 0;
  console.log(`${negOk ? 'PASS' : 'FAIL'}  marker-contract negative-control (tampered degraded flag is rejected)`);
  const total = cases.length * 2 + 1;
  if (negOk) pass++;
  console.log(`${pass}/${total} passed`);
  process.exit(pass === total ? 0 : 1);
}

module.exports = { classify, buildMarker, validateMarker, degradedMarkerBroken };

// require.main-Guard: ohne ihn wuerde ein `require('./coverage-gate.js')' aus
// einem Test heraus sofort run()/selftest() gegen echte ./snapshots,
// ./watchlist.json feuern und process.exit() aufrufen. Verhalten beim
// direkten `node scripts/coverage-gate.js [--selftest]`-Aufruf unveraendert.
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else run();
}
