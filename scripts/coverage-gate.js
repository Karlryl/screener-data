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
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const SNAP_DIR = './snapshots';
const MANIFEST = path.join(SNAP_DIR, '_manifest.json');
const WATCHLIST = './watchlist.json';
const MARKER = './outputs/coverage-status.json';

// Thresholds — see workflow comment for rationale. HARD_FLOOR is the UNCHANGED
// current gate value (not lowered); SOFT_TARGET detects degradation only.
const HARD_ABS = 2500, HARD_PCT = 0.13;   // katastrophal floor = max(2500, 13%)
const SOFT_ABS = 4600, SOFT_PCT = 0.18;   // full-pull target  = max(4600, 18%)
const FAIL_MASS_MAX = 0.35;               // n_failed/(n_ok+n_failed) above this = degraded
// merge-shard-manifests.js refuses to publish a larger reconciliation gap.
const SHARD_COLLISION_ABS = 25, SHARD_COLLISION_PCT = 0.005;
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
  try { return fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).length; }
  catch (e) { return 0; }
}

// NA-SK-001 (Hard Review 2026-07-31): classify() trusted m.n_ok>0 as "manifest usable"
// without checking n_total>0, n_ok<=n_total or negative counters — {n_ok:5000,n_total:1}
// passed straight through to finishGood() and came out coverage_pct:500000, status:'ok'.
// A manifest whose own numbers are logically impossible is exactly as untrustworthy as
// a missing one — route it through the same fallback path instead of trusting it raw.
function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function optionalCountSane(value) {
  return !hasValue(value) || isCount(value);
}

function hasAddressableWarning(m) {
  return !!(m && typeof m._addressable_warnung === 'string' && m._addressable_warnung.trim());
}

function producerAddressable(m, total, warned) {
  if (!m || !isCount(total) || !isCount(m.n_skipped_mcap)) return null;
  let expected = total - m.n_skipped_mcap;
  if (!isCount(expected)) return null;
  // n_shard_collisions is the producer discriminator: merge manifests always
  // carry it (including zero), while direct pull-yahoo manifests omit it.
  if (!warned && hasValue(m.n_shard_collisions)) {
    if (!isCount(m.n_shard_collisions)) return null;
    const owned = hasValue(m.n_skipped_owned) ? m.n_skipped_owned : 0;
    if (!isCount(owned)) return null;
    expected -= owned;
  }
  return isCount(expected) ? expected : null;
}

function shardCollisionLimit(total) {
  return Math.max(SHARD_COLLISION_ABS, Math.floor(total * SHARD_COLLISION_PCT));
}

function manifestNumbersSane(m, fallbackTotal = null) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (!isCount(m.n_ok)) return false;

  const hasTotal = hasValue(m.n_total);
  if (hasTotal && (!isCount(m.n_total) || m.n_total === 0 || m.n_ok > m.n_total)) return false;
  const contextualTotal = hasTotal
    ? m.n_total
    : (isCount(fallbackTotal) && fallbackTotal > 0 ? fallbackTotal : null);

  const optionalFields = [
    'n_failed',
    'n_full',
    'n_priceonly',
    'n_addressable',
    'n_skipped_mcap',
    'n_skipped_owned',
    'n_shard_collisions',
  ];
  if (optionalFields.some(field => !optionalCountSane(m[field]))) return false;
  // The producer emits a boolean. A truthy string/object must not be laundered
  // into manifest_partial=false and silently clear the degradation banner.
  if (hasValue(m.partial) && typeof m.partial !== 'boolean') return false;

  const warningPresent = hasValue(m._addressable_warnung);
  const addressableWarning = hasAddressableWarning(m);
  if (warningPresent && !addressableWarning) return false;

  const hasAddressable = hasValue(m.n_addressable);
  const hasSkippedMcap = hasValue(m.n_skipped_mcap);
  const hasCollisions = hasValue(m.n_shard_collisions);
  const hasSkippedOwned = hasValue(m.n_skipped_owned);
  if (addressableWarning &&
      (!hasSkippedMcap || !hasCollisions || !hasSkippedOwned)) return false;
  // Every owned-aware merge producer also emits its exact denominator. Older
  // collision-bearing manifests predate both fields and remain compatible.
  if (hasCollisions && hasSkippedOwned && !hasAddressable) return false;

  let effectiveDenominator = contextualTotal;
  if (contextualTotal !== null && hasSkippedMcap) {
    effectiveDenominator = contextualTotal - m.n_skipped_mcap;
  }
  if (hasAddressable) {
    const expectedAddressable = producerAddressable(m, contextualTotal, addressableWarning);
    if (expectedAddressable === null || m.n_addressable !== expectedAddressable) return false;
    effectiveDenominator = m.n_addressable;
  }
  // A producer warning is explicit evidence that its conservative denominator could
  // not be reconciled with distinct files. Preserve the other counters, but never let
  // the warned denominator certify coverage; finishGood() degrades and suppresses it.
  if (effectiveDenominator !== null && m.n_ok > effectiveDenominator && !addressableWarning) return false;
  if (hasValue(m.n_failed) && !Number.isSafeInteger(m.n_ok + m.n_failed)) return false;

  const collisions = hasValue(m.n_shard_collisions) ? m.n_shard_collisions : 0;
  const classifiedTotal = m.n_ok + collisions;
  if (!Number.isSafeInteger(classifiedTotal)) return false;
  if (hasValue(m.n_shard_collisions) && contextualTotal !== null) {
    if (collisions > shardCollisionLimit(contextualTotal)) return false;
  }
  const hasFull = hasValue(m.n_full);
  const hasPriceOnly = hasValue(m.n_priceonly);
  if (hasFull && m.n_full > classifiedTotal) return false;
  if (hasPriceOnly && m.n_priceonly > classifiedTotal) return false;
  if (hasFull && hasPriceOnly) {
    const mixTotal = m.n_full + m.n_priceonly;
    if (!Number.isSafeInteger(mixTotal) || mixTotal !== classifiedTotal) return false;
  }
  return true;
}

// Pure classifier — unit-testable. Returns {status, reasons[], n_ok, n_total, source}.
function classify(m, wlSize, fCount) {
  const reasons = [];
  // A legacy manifest may omit n_total, but only the independently measured
  // watchlist size can replace it. File count is the numerator and cannot certify
  // itself as a denominator.
  const hasManifestTotal = !!(m && hasValue(m.n_total));
  const externalManifestTotal = isCount(wlSize) && wlSize > 0 ? wlSize : null;
  const resolvedManifestTotal = hasManifestTotal ? m.n_total : externalManifestTotal;
  const manifestUsable = resolvedManifestTotal !== null &&
    manifestNumbersSane(m, resolvedManifestTotal) && m.n_ok > 0;
  if (!manifestUsable) {
    // schema-broken / internally-inconsistent / no usable manifest: fall back to
    // on-disk file count (as old step did).
    const ok = fCount, total = wlSize > 0 ? wlSize : fCount, source = 'file-count/watchlist-denom';
    const hard = Math.max(HARD_ABS, Math.floor(total * HARD_PCT));
    // NRE-SK-001 (Hard Review 2026-07-31): the file-count fallback cannot see
    // partial/failure-mass/honest-coverage at all — it is a strictly weaker signal
    // than a real manifest. Passing it through to finishGood() let a broken/missing
    // manifest come out as a silent 'ok' whenever raw file counts happened to clear
    // the hard/soft floors — the SAME on-disk state that a real manifest reported as
    // 'degradiert' (partial=true, high failure-mass, low honest-coverage) went green
    // just because the manifest that would have proven it degraded failed to write/
    // parse. Absence of the manifest is itself an anomaly worth a banner: never let
    // this branch return a bare 'ok' — it always carries a reason.
    const brokenReason = !m
      ? 'manifest-unreadable-or-missing (schema-broken)'
      : (!isCount(m.n_ok)
        ? 'n_ok invalid in manifest'
        : (m.n_ok === 0 ? 'n_ok==0 in manifest' : 'manifest-internally-inconsistent (coverage counters impossible)'));
    if (!(ok > 0) || ok < hard) {
      reasons.push(brokenReason);
      if (ok < hard) reasons.push(`n_ok ${ok} < HARD_FLOOR ${hard}`);
      return { status: 'katastrophal', reasons, n_ok: ok, n_total: total, source };
    }
    reasons.push(brokenReason + ' — falling back to file-count (cannot verify partial/failure-mass/honest-coverage)');
    const out = finishGood(ok, total, source, null, reasons);
    out.status = 'degradiert'; // file-count fallback can never certify a clean 'ok'
    return out;
  }
  return finishGood(m.n_ok, resolvedManifestTotal, 'manifest', m, reasons);
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
  const addressableWarning = hasAddressableWarning(m);
  if (addressableWarning) {
    reasons.push(`manifest _addressable_warnung: ${m._addressable_warnung}`);
  }
  let addressable = null;
  if (!addressableWarning && m && isCount(m.n_addressable) && m.n_addressable > 0) {
    addressable = m.n_addressable;
  } else if (!addressableWarning && m && isCount(m.n_skipped_mcap) && isCount(total) &&
             total - m.n_skipped_mcap > 0) {
    addressable = total - m.n_skipped_mcap;
  }
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
  // Invalid manifests are classified through a visible file-count fallback. Never
  // launder their optional counters or flags into the marker emitted by that fallback.
  const trustedManifest = res.source === 'manifest' && manifestNumbersSane(m, res.n_total) ? m : null;
  const markerCount = (field) => trustedManifest && isCount(trustedManifest[field])
    ? trustedManifest[field]
    : null;
  return {
    schema: 'coverage-status/v1',
    generated_at: new Date().toISOString(),
    run_id: process.env.GITHUB_RUN_ID || null,
    status: res.status,                 // 'ok' | 'degradiert' | 'katastrophal'
    degraded: res.status !== 'ok',      // dashboard banner on/off
    blocked: res.status === 'katastrophal',
    n_ok: res.n_ok,
    n_total: res.n_total,
    n_full: markerCount('n_full'),              // 0.9 instrumentation
    n_priceonly: markerCount('n_priceonly'),
    n_shard_collisions: markerCount('n_shard_collisions'),
    coverage_pct: coveragePct,
    // Task 0.12: ehrlicher Nenner + ehrliche Coverage (null bei Legacy-Manifest ohne mcap-Zählung)
    n_addressable: isCount(res.n_addressable) ? res.n_addressable : null,
    honest_coverage_pct: Number.isFinite(res.honest_coverage_pct) ? res.honest_coverage_pct : null,
    manifest_addressable_warning: !!(trustedManifest && hasAddressableWarning(trustedManifest)),
    // Tag 464: sichtbar machen, WARUM der Nenner kleiner ist als das Universum. Ohne diese
    // Zahl sieht man im Marker nur ein geschrumpftes n_addressable und kann nicht pruefen,
    // ob der Abzug stimmt. Nur Anzeige — die Klassifizierung liest sie nicht.
    n_skipped_mcap: markerCount('n_skipped_mcap'),
    n_skipped_owned: markerCount('n_skipped_owned'),
    source: res.source,
    reasons: res.reasons,
    manifest_partial: !!(trustedManifest && trustedManifest.partial === true)
  };
}

// Contract guard: coverage-status.json ist Karls EINZIGER sanktionierter Alarm-Kanal
// (Dashboard-Degradiert-Banner; kein Mail/Discord). Ein stiller Schema-Bruch (fehlendes
// degraded/blocked, falscher Typ, status<->degraded/blocked-Inkonsistenz) wuerde den Banner
// lautlos abschalten -> Fail-silent statt Fail-loud. validateMarker liefert die Liste der
// Vertragsverletzungen (leer = ok); im Selftest hart gepinnt.
const VALID_STATUS = ['ok', 'degradiert', 'katastrophal'];
function printable(value) {
  try { return String(value); } catch (e) { return '<unprintable>'; }
}
function validateMarker(mk) {
  if (!mk || typeof mk !== 'object' || Array.isArray(mk)) return ['marker not an object'];
  const errs = [];
  if (mk.schema !== 'coverage-status/v1') errs.push(`schema=${printable(mk.schema)}`);
  if (!VALID_STATUS.includes(mk.status)) errs.push(`status=${printable(mk.status)}`);
  if (typeof mk.degraded !== 'boolean') errs.push('degraded not boolean');
  if (typeof mk.blocked !== 'boolean') errs.push('blocked not boolean');
  if (mk.degraded !== (mk.status !== 'ok')) errs.push('degraded inconsistent with status');
  if (mk.blocked !== (mk.status === 'katastrophal')) errs.push('blocked inconsistent with status');
  for (const f of ['n_ok', 'n_total']) {
    if (!isCount(mk[f])) errs.push(`${f} not a non-negative safe integer`);
  }
  if (!Number.isFinite(mk.coverage_pct) || mk.coverage_pct < 0 || mk.coverage_pct > 100)
    errs.push('coverage_pct outside 0..100');
  if (!Array.isArray(mk.reasons)) errs.push('reasons not array');
  if (typeof mk.manifest_addressable_warning !== 'boolean')
    errs.push('manifest_addressable_warning not boolean');
  // Manifest counters are nullable for legacy/fallback markers; derived percentages
  // may carry one decimal but must stay inside their physical range.
  for (const f of ['n_full', 'n_priceonly', 'n_shard_collisions', 'n_addressable', 'n_skipped_mcap', 'n_skipped_owned']) {
    if (mk[f] !== null && !isCount(mk[f])) errs.push(`${f} present but not a non-negative safe integer`);
  }
  if (mk.honest_coverage_pct !== null &&
      (!Number.isFinite(mk.honest_coverage_pct) || mk.honest_coverage_pct < 0 || mk.honest_coverage_pct > 100)) {
    errs.push('honest_coverage_pct outside 0..100');
  }

  const primaryCountsValid = isCount(mk.n_ok) && isCount(mk.n_total);
  if (primaryCountsValid) {
    if (mk.n_ok > mk.n_total) errs.push('n_ok exceeds n_total');
    const expectedCoverage = mk.n_total > 0 ? +(mk.n_ok / mk.n_total * 100).toFixed(1) : 0;
    if (mk.coverage_pct !== expectedCoverage) errs.push('coverage_pct inconsistent with counts');
  }

  const optionalCountValid = field => mk[field] === null || isCount(mk[field]);
  if (optionalCountValid('n_addressable') && mk.n_addressable !== null &&
      (!optionalCountValid('n_skipped_mcap') || mk.n_skipped_mcap === null)) {
    errs.push('n_addressable present without n_skipped_mcap');
  }
  if (primaryCountsValid && optionalCountValid('n_skipped_mcap') && mk.n_skipped_mcap !== null) {
    if (mk.n_skipped_mcap > mk.n_total) errs.push('n_skipped_mcap exceeds n_total');
    if (mk.status !== 'katastrophal' && mk.manifest_addressable_warning === false &&
        mk.n_addressable === null &&
        mk.n_total - mk.n_skipped_mcap > 0) {
      errs.push('n_addressable missing despite measurable mcap denominator');
    }
    if (optionalCountValid('n_addressable') && mk.n_addressable !== null &&
        mk.manifest_addressable_warning === false) {
      const expectedAddressable = producerAddressable(mk, mk.n_total, false);
      if (expectedAddressable === null || mk.n_addressable !== expectedAddressable)
        errs.push('n_addressable inconsistent with producer formula');
    }
    if (mk.n_addressable === null && !mk.manifest_addressable_warning &&
        mk.n_ok > mk.n_total - mk.n_skipped_mcap) {
      errs.push('n_ok exceeds n_total minus n_skipped_mcap');
    }
  }

  const collisions = optionalCountValid('n_shard_collisions') && mk.n_shard_collisions !== null
    ? mk.n_shard_collisions
    : 0;
  const classifiedTotal = primaryCountsValid ? mk.n_ok + collisions : null;
  const classifiedTotalValid = classifiedTotal !== null && Number.isSafeInteger(classifiedTotal);
  if (classifiedTotal !== null && !classifiedTotalValid) errs.push('n_ok+n_shard_collisions exceeds safe integer range');
  if (primaryCountsValid && optionalCountValid('n_shard_collisions') && mk.n_shard_collisions !== null) {
    if (mk.n_shard_collisions > shardCollisionLimit(mk.n_total))
      errs.push('n_shard_collisions exceeds producer hard limit');
  }
  if (classifiedTotalValid && optionalCountValid('n_full') && mk.n_full !== null && mk.n_full > classifiedTotal)
    errs.push('n_full exceeds collision-adjusted n_ok');
  if (classifiedTotalValid && optionalCountValid('n_priceonly') && mk.n_priceonly !== null && mk.n_priceonly > classifiedTotal)
    errs.push('n_priceonly exceeds collision-adjusted n_ok');
  if (classifiedTotalValid && optionalCountValid('n_full') && optionalCountValid('n_priceonly') &&
      mk.n_full !== null && mk.n_priceonly !== null) {
    const mixTotal = mk.n_full + mk.n_priceonly;
    if (!Number.isSafeInteger(mixTotal) || mixTotal !== classifiedTotal)
      errs.push('n_full+n_priceonly inconsistent with n_ok+n_shard_collisions');
  }

  if (mk.manifest_addressable_warning === true) {
    if (mk.status === 'ok') errs.push('addressable warning inconsistent with ok status');
    if (!optionalCountValid('n_skipped_mcap') || mk.n_skipped_mcap === null)
      errs.push('addressable warning missing n_skipped_mcap');
    if (!optionalCountValid('n_skipped_owned') || mk.n_skipped_owned === null)
      errs.push('addressable warning missing n_skipped_owned');
    if (!optionalCountValid('n_shard_collisions') || mk.n_shard_collisions === null)
      errs.push('addressable warning missing merge discriminator');
    if (mk.n_addressable !== null) errs.push('warned n_addressable must be suppressed');
    if (mk.honest_coverage_pct !== null) errs.push('warned honest_coverage_pct must be suppressed');
  } else if (mk.n_addressable === null) {
    if (mk.honest_coverage_pct !== null) errs.push('honest_coverage_pct present without n_addressable');
  } else if (isCount(mk.n_addressable)) {
    if (mk.n_addressable === 0) {
      if (mk.honest_coverage_pct !== null) errs.push('honest_coverage_pct present for zero n_addressable');
    } else if (primaryCountsValid && Number.isFinite(mk.honest_coverage_pct)) {
      const expectedHonest = +(mk.n_ok / mk.n_addressable * 100).toFixed(1);
      if (mk.honest_coverage_pct !== expectedHonest)
        errs.push('honest_coverage_pct inconsistent with counts');
    } else if (primaryCountsValid) {
      errs.push('honest_coverage_pct missing for n_addressable');
    }
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
  const mix = marker.n_full !== null || marker.n_priceonly !== null
    ? ` full=${marker.n_full == null ? '?' : marker.n_full} price-only=${marker.n_priceonly == null ? '?' : marker.n_priceonly}`
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
    [{ n_ok: 10672, n_total: 15212, partial: false, n_failed: 1678, n_skipped_mcap: 2256, n_skipped_owned: 583, n_addressable: 12373, n_shard_collisions: 0 }, 'degradiert'],
    // Und die Gegenrichtung: waeren die 1678 Fehlschlaege behoben, geht der Banner aus.
    [{ n_ok: 12000, n_total: 15212, partial: false, n_failed: 350, n_skipped_mcap: 2256, n_skipped_owned: 583, n_addressable: 12373, n_shard_collisions: 0 }, 'ok'],
    // ⚠ DER GEFAEHRLICHSTE PFAD, von der unabhaengigen Pruefung am 27.07. als Testluecke
    // gemeldet: genau DIESE Manifest-Form schreibt pull-yahoo.js beim inkrementellen (partial)
    // und beim Einzellauf — n_skipped_mcap UND n_skipped_owned gesetzt, n_addressable FEHLT.
    // Dort ist n_total bereits um die uebersprungenen Namen reduziert, der Fallback darf sie
    // also NICHT nochmal abziehen. Wer aus Ehrlichkeits-Impuls "- n_skipped_owned" ergaenzt,
    // erzeugt genau den Doppelabzug, gegen den der ganze Umbau gebaut ist — Nenner zu klein,
    // Abdeckung zu hoch, Karls einziger Alarm dauerhaft gruen.
    // Der Fall unten ist so gewaehlt, dass der Doppelabzug das Urteil KIPPEN wuerde:
    //   richtig:  9000/10000 = 90,0 %  -> genau auf der Latte -> ok
    //   falsch:   9000/(10000-583) = 95,6 % -> ebenfalls ok, aber die Zahl waere gelogen;
    //   deshalb pinnt der Selftest zusaetzlich den ausgewiesenen Prozentwert im Marker.
    [{ n_ok: 9000, n_total: 12256, partial: false, n_failed: 200, n_skipped_mcap: 2256, n_skipped_owned: 583 }, 'ok'],
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
  // ⚠ Der Doppelabzug-Test zum Fall oben: der Fallback-Nenner MUSS n_total - n_skipped_mcap
  // sein, NICHT zusaetzlich minus n_skipped_owned. Der Statuswert allein wuerde beide Varianten
  // durchlassen — deshalb wird hier die ZAHL festgenagelt.
  const inkrementell = { n_ok: 9000, n_total: 12256, partial: false, n_failed: 200, n_skipped_mcap: 2256, n_skipped_owned: 583 };
  const mkInk = buildMarker(classify(inkrementell, N, 0), inkrementell);
  const nennerOk = mkInk.n_addressable === 10000;
  const pctOk = mkInk.honest_coverage_pct === 90;
  console.log(`${nennerOk && pctOk ? 'PASS' : 'FAIL'}  kein Doppelabzug im Fallback-Nenner (erwartet 9000/10000 = 90 %, bekommen ${mkInk.n_ok}/${mkInk.n_addressable} = ${mkInk.honest_coverage_pct} %)`);
  if (nennerOk && pctOk) pass++;

  // Negativ-Kontrolle: validateMarker MUSS einen kaputten Marker fangen (sonst waere der
  // Guard wertlos). cases[2] ist 'degradiert' -> degraded MUSS true sein; wir faelschen es auf
  // false (Banner lautlos aus) und erwarten, dass der Guard das ablehnt.
  const tampered = buildMarker(classify(cases[2][0], N, 0), cases[2][0]);
  tampered.degraded = false;
  const negOk = validateMarker(tampered).length > 0;
  console.log(`${negOk ? 'PASS' : 'FAIL'}  marker-contract negative-control (tampered degraded flag is rejected)`);
  if (negOk) pass++;

  // NA-SK-001 (Hard Review 2026-07-31): ein Manifest mit logisch unmoeglichen Zahlen
  // (n_ok > n_total) durfte NICHT wie ein gesundes Manifest durchgereicht werden.
  const unmoeglich = { n_ok: 5000, n_total: 1, partial: false, n_failed: 0 };
  const resUnmoeglich = classify(unmoeglich, N, 0);
  const naSk001Ok = resUnmoeglich.status !== 'ok' && resUnmoeglich.source !== 'manifest';
  console.log(`${naSk001Ok ? 'PASS' : 'FAIL'}  NA-SK-001: n_ok>n_total wird verworfen statt als 'ok' durchgereicht (status=${resUnmoeglich.status} source=${resUnmoeglich.source})`);
  if (naSk001Ok) pass++;
  const negativ = { n_ok: 100, n_total: -5, partial: false };
  const resNegativ = classify(negativ, N, 0);
  const naSk001NegOk = resNegativ.status !== 'ok' && resNegativ.source !== 'manifest';
  console.log(`${naSk001NegOk ? 'PASS' : 'FAIL'}  NA-SK-001: negatives n_total wird verworfen (status=${resNegativ.status} source=${resNegativ.source})`);
  if (naSk001NegOk) pass++;

  // NRE-SK-001 (Hard Review 2026-07-31): der Datei-Fallback (kein/kaputtes Manifest)
  // darf NIE 'ok' zurueckgeben, selbst wenn die rohe Dateizahl die Schwellen locker
  // reisst — er kann partial/failure-mass/honest-coverage nicht sehen und ist damit
  // strukturell blind fuer genau die Zustaende, die ein echtes Manifest als
  // 'degradiert' melden wuerde. Realistischer Fall: gleiche Dateizahl wie ein
  // gesunder Voll-Pull, aber das Manifest fehlt (Schreibfehler in merge-shard-
  // manifests.js).
  const resFallback = classify(null, N, Math.floor(N * 0.9)); // 90% der Dateien vorhanden, KEIN Manifest
  const nreSk001Ok = resFallback.status === 'degradiert';
  console.log(`${nreSk001Ok ? 'PASS' : 'FAIL'}  NRE-SK-001: Datei-Fallback ohne Manifest ist bestenfalls 'degradiert', nie 'ok' (status=${resFallback.status})`);
  if (nreSk001Ok) pass++;

  const total = cases.length * 2 + 2 + 3;   // +1 Doppelabzug, +1 Negativ-Kontrolle, +3 NA/NRE-SK-001
  console.log(`${pass}/${total} passed`);
  process.exit(pass === total ? 0 : 1);
}

module.exports = { classify, buildMarker, validateMarker, degradedMarkerBroken, manifestNumbersSane };

// require.main-Guard: ohne ihn wuerde ein `require('./coverage-gate.js')' aus
// einem Test heraus sofort run()/selftest() gegen echte ./snapshots,
// ./watchlist.json feuern und process.exit() aufrufen. Verhalten beim
// direkten `node scripts/coverage-gate.js [--selftest]`-Aufruf unveraendert.
if (require.main === module) {
  if (process.argv.includes('--selftest')) selftest();
  else run();
}
