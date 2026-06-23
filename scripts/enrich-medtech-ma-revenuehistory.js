#!/usr/bin/env node
/**
 * Medtech M&A Snapshot — LOCAL revenueHistory enrichment (v1.4)
 *
 * audit/fix (gauntlet C6): brings the medtech M&A snapshot up to the dlst
 * treatment. The dlst snapshot carries a per-year `revenueHistory` [{val,end}]
 * so the goodwill-jump denominator can be scaled per YEAR (Fix 1) instead of by
 * a single revLatest scalar. The medtech v1.1 snapshot only had a single
 * `annualRevenue` scalar. This script reconstructs `revenueHistory` for each
 * medtech ticker PURELY FROM LOCAL DATA — NO network, NO sec.gov, NO companyfacts
 * zip. It reads the SAME local source the YoY series is built from:
 *   snapshots/<T>.json  →  annual.annualRev  (newest-first, object-wrapped {value})
 *
 * Source-alignment guarantee (why this is correct & safe):
 *   - court-screen.js builds revYoYMedtech[i] = revA[i]/revA[i+1]-1 where
 *     revA = arr(p.ftsAnnual.annualRev) — i.e. the SAME annualRev array.
 *   - goodwillHistory[i] (already in the snapshot) is newest-first annual with
 *     period-end `.end`, calendar-year-aligned with annualRev[i] (verified for
 *     all 67 names: goodwillHistory[i].end-year == fiscal year of annualRev[i]).
 *   Therefore revenueHistory[i].val := num(annualRev[i]) is exactly THAT year's
 *   revenue — the per-year denominator for the goodwill jump goodwillHistory[i]
 *   vs goodwillHistory[i+1]. The `.end` label is taken from goodwillHistory[i].end
 *   when present (same fiscal axis), keeping the dlst {val,end} shape identical.
 *
 * Mirrors the dlst snapshot's revenueHistory shape: array of {val, end},
 * newest-first. Writes back to data/ma-rpo-snapshot-medtech.json in place and
 * bumps the header note to v1.4.
 *
 * Reproduce:
 *   node scripts/enrich-medtech-ma-revenuehistory.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SNAP_PATH = path.join(REPO_ROOT, 'data', 'ma-rpo-snapshot-medtech.json');
const SNAPSHOTS_DIR = path.join(REPO_ROOT, 'snapshots');

// Same dual-shape extractor used by court-screen.js num() (object-wrapped {value}).
function num(x) {
  if (x == null) return null;
  if (typeof x === 'number') return isFinite(x) ? x : null;
  if (typeof x === 'object' && 'value' in x) return num(x.value);
  const n = Number(x);
  return isFinite(n) ? n : null;
}

function main() {
  if (!fs.existsSync(SNAP_PATH)) {
    console.error(`FATAL: medtech snapshot not found at ${SNAP_PATH}`);
    process.exit(1);
  }
  const snap = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));

  let enriched = 0, emptyRev = 0, noLocalSnap = 0, total = 0;
  const probe = [];

  for (const [ticker, rec] of Object.entries(snap)) {
    if (ticker === '_header' || !rec || typeof rec !== 'object') continue;
    total++;

    const localPath = path.join(SNAPSHOTS_DIR, `${ticker}.json`);
    if (!fs.existsSync(localPath)) {
      // No local snapshot → cannot reconstruct locally. Leave revenueHistory empty
      // (the score path falls back to revLatest, exactly like a thin dlst name).
      rec.revenueHistory = [];
      noLocalSnap++;
      continue;
    }

    let local;
    try {
      local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } catch (e) {
      rec.revenueHistory = [];
      noLocalSnap++;
      console.warn(`  ${ticker}: local snapshot parse error (${e.message}) — revenueHistory=[]`);
      continue;
    }

    // newest-first per-year revenue from the LOCAL snapshot (same array court-screen reads)
    const revVals = ((local.annual && local.annual.annualRev) || []).map(num);

    // .end labels: index-aligned goodwillHistory[i].end (same fiscal axis). Where goodwill
    // history is shorter than the revenue series (or absent), the surplus revenue years get a
    // null end — harmless, since the per-year denominator is only read at indices that HAVE a
    // goodwill pair (i in [0, goodwillHistory.length-1]).
    const gwHist = Array.isArray(rec.goodwillHistory) ? rec.goodwillHistory : [];

    const revenueHistory = [];
    for (let i = 0; i < revVals.length; i++) {
      const v = revVals[i];
      if (v == null) continue; // drop non-finite (mirrors arr() filtering; keeps index meaning for finite leading run)
      const end = (gwHist[i] && gwHist[i].end) ? gwHist[i].end : null;
      revenueHistory.push({ val: v, end });
    }

    rec.revenueHistory = revenueHistory;
    if (revenueHistory.length === 0) emptyRev++;
    else enriched++;

    if (['ABT', 'GMED', 'AHCO', 'MDT', 'SYK', 'ISRG'].includes(ticker)) {
      probe.push(`  ${ticker.padEnd(6)}: revenueHistory=[${revenueHistory.map(r => `${r.end || '?'}:${(r.val / 1e9).toFixed(2)}B`).join(' ')}]`);
    }
  }

  // Bump header note (additive — keeps v1.1 fields, documents the v1.4 enrichment).
  snap._header = snap._header || {};
  snap._header.note = 'v1.4: revenueHistory[{val,end}] added (LOCAL reconstruction from snapshots/<T>.json annual.annualRev, .end from goodwillHistory[i].end) for per-year goodwill-jump denominator, mirroring dlst snapshot shape (Fix 1). v1.1 fields retained: maxGoodwillJumpPctRev (3yr window) + goodwillHistory; delta-goodwill primary inorganic proxy; payments control-only.';

  fs.writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2), 'utf8');

  console.log('=== Medtech M&A revenueHistory LOCAL enrichment (v1.4) ===');
  console.log(`Source (LOCAL only): snapshots/<T>.json annual.annualRev — NO network`);
  console.log(`Wrote: ${SNAP_PATH}\n`);
  console.log(`Tickers:                 ${total}`);
  console.log(`  enriched (rev>=1 yr):  ${enriched}`);
  console.log(`  empty annualRev:       ${emptyRev}`);
  console.log(`  no local snapshot:     ${noLocalSnap}`);
  console.log('\nProbe (marquee names):');
  probe.forEach(l => console.log(l));
  console.log('\nDone.');
}

main();
