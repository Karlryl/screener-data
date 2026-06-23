#!/usr/bin/env node
/**
 * D&LST M&A Goodwill Snapshot Generator
 *
 * Produces: data/ma-rpo-snapshot-dlst.json
 * NEVER touches: data/ma-rpo-snapshot.json (SaaS/Fabless)
 *                data/ma-rpo-snapshot-medtech.json (Medtech)
 *
 * Data source: C:\Users\Karlr\AppData\Local\sec-xbrl-cache\companyfacts.zip
 * Freshness cutoff: 400 days from anchor 2026-06-21 → 2025-05-17
 *
 * CRITICAL FIXES vs medtech v1.1:
 *   Fix 1 — PER-YEAR REVENUE DENOMINATOR: each year's deltaGoodwill is scaled
 *     by THAT year's revenue, not revLatest. This prevents fabricated >100%
 *     jumps on divestitures/spins (RVTY PerkinElmer split, ILMN GRAIL decon.).
 *   Fix 2 — NEGATIVE/IMPAIRMENT CLAMP: deltaGoodwill < 0 is an impairment,
 *     NOT an acquisition. These years are excluded from maxGoodwillJumpPctRev
 *     and cumDeltaGoodwillPctRev. An impairmentFlag is set when ANY year shows
 *     negative deltaGoodwill ≥ 5% of that year's revenue.
 *
 * Reproduce:
 *   node scripts/generate-dlst-ma-snapshot.js
 *
 * D&LST universe (n=29):
 *   A, ADPT, AVTR, AZTA, BIO, BRKR, CDNA, CRL, DHR, EXAS, GH, GRAL,
 *   IDXX, ILMN, IQV, MEDP, MTD, NEO, NEOG, NTRA, OPK, PSNL, RGEN,
 *   RVTY, TMO, TWST, VCYT, WAT, WGS
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Paths ─────────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const ZIP_PATH  = 'C:/Users/Karlr/AppData/Local/sec-xbrl-cache/companyfacts.zip';
const OUT_PATH  = path.join(REPO_ROOT, 'data', 'ma-rpo-snapshot-dlst.json');

// Safety guard — never overwrite the existing snapshots
const FORBIDDEN_PATHS = [
  path.join(REPO_ROOT, 'data', 'ma-rpo-snapshot.json'),
  path.join(REPO_ROOT, 'data', 'ma-rpo-snapshot-medtech.json'),
];

// ── Freshness cutoff ──────────────────────────────────────────────────────────
const ANCHOR_DATE  = new Date('2026-06-21');
const STALE_CUTOFF = new Date(ANCHOR_DATE);
STALE_CUTOFF.setDate(STALE_CUTOFF.getDate() - 400);
const STALE_STR = STALE_CUTOFF.toISOString().slice(0, 10); // '2025-05-17'

// ── D&LST universe (n=29) ─────────────────────────────────────────────────────
// Diagnostics & Life-Science Tools: genomics, dx, CRO, lab instruments, CDMO/reagents
const DLST_TICKERS = [
  'A', 'ADPT', 'AVTR', 'AZTA', 'BIO', 'BRKR', 'CDNA', 'CRL', 'DHR', 'EXAS',
  'GH', 'GRAL', 'IDXX', 'ILMN', 'IQV', 'MEDP', 'MTD', 'NEO', 'NEOG', 'NTRA',
  'OPK', 'PSNL', 'RGEN', 'RVTY', 'TMO', 'TWST', 'VCYT', 'WAT', 'WGS',
];

// ── Embedded CIK map ──────────────────────────────────────────────────────────
// Sourced from SEC network + _dlst-ma-dump.js run on 2026-06-20/21.
// Key = ticker, value = 10-digit zero-padded CIK string.
const KNOWN_CIKS = {
  'A':    '0001090872',
  'ADPT': '0001766183',
  'AVTR': '0001722482',
  'AZTA': '0000933974',
  'BIO':  '0000012208',
  'BRKR': '0001109354',
  'CDNA': '0001399067',
  'CRL':  '0001100682',
  'DHR':  '0000313616',
  'EXAS': '0001124140',
  'GH':   '0001754068',
  'GRAL': '0001837686',
  'IDXX': '0000874716',
  'ILMN': '0001110803',
  'IQV':  '0001478242',
  'MEDP': '0001557798',
  'MTD':  '0001037646',
  'NEO':  '0001580063',
  'NEOG': '0000711377',
  'NTRA': '0001411579',
  'OPK':  '0000944695',
  'PSNL': '0001487718',
  'RGEN': '0000730272',
  'RVTY': '0000031791',
  'TMO':  '0000097745',
  'TWST': '0001674930',
  'VCYT': '0001460329',
  'WAT':  '0001000697',
  'WGS':  '0001840292',
};

// ── ZIP parser (identical mechanics to generate-medtech-ma-snapshot.js) ───────
function readUInt32LE(buf, offset) { return buf.readUInt32LE(offset); }
function readUInt16LE(buf, offset) { return buf.readUInt16LE(offset); }

function findEndOfCentralDir(fd, fileSize) {
  const scanSize = Math.min(65557, fileSize);
  const buf = Buffer.alloc(scanSize);
  fs.readSync(fd, buf, 0, scanSize, fileSize - scanSize);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      const cdOffset = readUInt32LE(buf, i + 16);
      const cdSize   = readUInt32LE(buf, i + 12);
      const cdCount  = readUInt16LE(buf, i + 10);
      if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
        return findEndOfCentralDir64(fd, fileSize, (fileSize - scanSize) + i);
      }
      return { cdOffset, cdSize, cdCount };
    }
  }
  throw new Error('EOCD signature not found');
}

function findEndOfCentralDir64(fd, fileSize, eocdPos) {
  const locBuf = Buffer.alloc(20);
  fs.readSync(fd, locBuf, 0, 20, eocdPos - 20);
  if (locBuf.readUInt32LE(0) !== 0x07064b50) throw new Error('ZIP64 locator not found');
  const eocd64Offset = Number(locBuf.readBigUInt64LE(8));
  const eocd64Buf = Buffer.alloc(56);
  fs.readSync(fd, eocd64Buf, 0, 56, eocd64Offset);
  if (eocd64Buf.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 EOCD not found');
  return {
    cdSize:   Number(eocd64Buf.readBigUInt64LE(40)),
    cdOffset: Number(eocd64Buf.readBigUInt64LE(48)),
    cdCount:  Number(eocd64Buf.readBigUInt64LE(24)),
  };
}

function buildCentralDirectory(fd, cdOffset, cdSize) {
  const cdBuf = Buffer.alloc(cdSize);
  fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);
  const index = new Map();
  let pos = 0;
  while (pos < cdBuf.length - 4) {
    const sig = cdBuf.readUInt32LE(pos);
    if (sig !== 0x02014b50) break;
    const method     = readUInt16LE(cdBuf, pos + 10);
    const compSize   = readUInt32LE(cdBuf, pos + 20);
    const uncompSize = readUInt32LE(cdBuf, pos + 24);
    const fnLen      = readUInt16LE(cdBuf, pos + 28);
    const extraLen   = readUInt16LE(cdBuf, pos + 30);
    const commentLen = readUInt16LE(cdBuf, pos + 32);
    let localOffset  = readUInt32LE(cdBuf, pos + 42);
    const fileName   = cdBuf.subarray(pos + 46, pos + 46 + fnLen).toString('utf8');
    if (localOffset === 0xFFFFFFFF) {
      const extraStart = pos + 46 + fnLen;
      let ep = extraStart;
      while (ep < extraStart + extraLen - 3) {
        const hid  = cdBuf.readUInt16LE(ep);
        const hlen = cdBuf.readUInt16LE(ep + 2);
        if (hid === 0x0001) {
          let z64pos = ep + 4;
          if (uncompSize === 0xFFFFFFFF) z64pos += 8;
          if (compSize   === 0xFFFFFFFF) z64pos += 8;
          if (localOffset === 0xFFFFFFFF) { localOffset = Number(cdBuf.readBigUInt64LE(z64pos)); }
          index.set(fileName, { localHeaderOffset: localOffset, compSize, uncompSize, method });
          break;
        }
        ep += 4 + hlen;
      }
    } else {
      index.set(fileName, { localHeaderOffset: localOffset, compSize, uncompSize, method });
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return index;
}

function readEntry(fd, entry) {
  const lhBuf = Buffer.alloc(30);
  fs.readSync(fd, lhBuf, 0, 30, entry.localHeaderOffset);
  const fnLen    = readUInt16LE(lhBuf, 26);
  const extraLen = readUInt16LE(lhBuf, 28);
  const dataOffset = entry.localHeaderOffset + 30 + fnLen + extraLen;
  const compBuf = Buffer.alloc(entry.compSize);
  fs.readSync(fd, compBuf, 0, entry.compSize, dataOffset);
  if (entry.method === 0) return compBuf;
  if (entry.method === 8) return zlib.inflateRawSync(compBuf);
  throw new Error('Unsupported compression method: ' + entry.method);
}

// ── XBRL helpers ─────────────────────────────────────────────────────────────

function isStale(dateStr) {
  if (!dateStr) return true;
  return dateStr < STALE_STR;
}

// Returns all non-stale annual (10-K/10-K/A/20-F/40-F) records, sorted newest-first.
function getAnnuals(unitArr) {
  if (!Array.isArray(unitArr)) return [];
  const annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
  return annuals;
}

// Returns up to N deduplicated annual records (one per fiscal year), newest-first.
// Only includes records where at least the latest is non-stale.
//
// Deduplication is by calendar year of end date. This works for the vast
// majority of tickers. For revenue specifically, stub transition-period 10-Ks
// (when a company changes FYE) are pre-filtered by pickNAnnualsRev below.
function pickNAnnuals(unitArr, n) {
  const annuals = getAnnuals(unitArr);

  // Find index of the latest non-stale annual
  let latestIdx = -1;
  for (let i = 0; i < annuals.length; i++) {
    if (!isStale(annuals[i].end)) { latestIdx = i; break; }
  }
  if (latestIdx < 0) return [];

  // Deduplicate by calendar year of end date (keep one per year, newest-end first)
  const seen = new Set();
  const result = [];
  for (let i = latestIdx; i < annuals.length && result.length < n; i++) {
    const yr = annuals[i].end ? annuals[i].end.slice(0, 4) : null;
    if (!yr || seen.has(yr)) continue;
    seen.add(yr);
    result.push({ val: annuals[i].val, end: annuals[i].end, form: annuals[i].form });
  }
  return result;
}

// Revenue-specific annual picker: same as pickNAnnuals but pre-filters stub/
// transition-period 10-Ks before deduplication. A stub period is a 10-K whose
// period span (start→end) is less than 9 months. SEC data includes `start` dates
// for most records which lets us detect this. If `start` is absent, we use the
// preceding record's end as a proxy.
//
// This handles AZTA's FYE change: the stub Dec31 transition period is excluded,
// leaving the full Sep30 annual correctly selected for each fiscal year.
function pickNAnnualsRev(unitArr, n) {
  if (!Array.isArray(unitArr)) return [];
  // Filter to annual forms first
  let annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));

  // Remove stub periods: if `start` is present and end-start < 270 days, skip.
  annuals = annuals.filter(u => {
    if (!u.start || !u.end) return true; // no start date → keep
    const days = (new Date(u.end).getTime() - new Date(u.start).getTime()) / 86400000;
    return days >= 270; // must be at least ~9 months
  });

  // Find latest non-stale
  let latestIdx = -1;
  for (let i = 0; i < annuals.length; i++) {
    if (!isStale(annuals[i].end)) { latestIdx = i; break; }
  }
  if (latestIdx < 0) return [];

  // Deduplicate by calendar year
  const seen = new Set();
  const result = [];
  for (let i = latestIdx; i < annuals.length && result.length < n; i++) {
    const yr = annuals[i].end ? annuals[i].end.slice(0, 4) : null;
    if (!yr || seen.has(yr)) continue;
    seen.add(yr);
    result.push({ val: annuals[i].val, end: annuals[i].end, form: annuals[i].form });
  }
  return result;
}

function pct4(n, denom) {
  if (n == null || denom == null || denom === 0) return null;
  return Math.round((n / denom) * 10000) / 10000;
}

// ── CIK resolution ────────────────────────────────────────────────────────────
async function getCikMap() {
  try {
    const { fetchSecTickers } = require('../discovery/sec-tickers.js');
    console.log('  CIK-Map: Fetching via sec.gov network call...');
    const map = await fetchSecTickers();
    if (map.size > 1000) {
      console.log(`  CIK-Map: OK — ${map.size} entries from network`);
      return { source: 'network', map };
    }
    console.warn(`  CIK-Map: Network returned only ${map.size} entries — falling back to embedded CIKs`);
  } catch (e) {
    console.warn(`  CIK-Map: Network error (${e.message}) — falling back to embedded CIKs`);
  }
  console.log('  CIK-Map: Using embedded KNOWN_CIKS fallback');
  const map = new Map();
  for (const [t, cik] of Object.entries(KNOWN_CIKS)) {
    map.set(t, { cik });
  }
  return { source: 'embedded_fallback', map };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Safety guard
  if (FORBIDDEN_PATHS.includes(OUT_PATH)) {
    console.error('FATAL: OUT_PATH would overwrite a forbidden snapshot!');
    process.exit(1);
  }

  console.log('=== D&LST M&A Goodwill Snapshot Generator ===');
  console.log(`Anchor date:       ${ANCHOR_DATE.toISOString().slice(0, 10)}`);
  console.log(`Freshness cutoff:  ${STALE_STR} (400-day window)`);
  console.log(`Universe:          ${DLST_TICKERS.length} tickers`);
  console.log(`Output:            ${OUT_PATH}`);
  console.log(`Forbidden (guard): ${FORBIDDEN_PATHS.join(', ')}\n`);
  console.log('Critical fixes active:');
  console.log('  Fix 1 — Per-year revenue denominator (not revLatest)');
  console.log('  Fix 2 — Negative deltaGoodwill clamped as impairment, not deal\n');

  // Step 1: CIK map
  const { source: cikSource, map: cikMap } = await getCikMap();

  // Step 2: Open ZIP
  if (!fs.existsSync(ZIP_PATH)) {
    console.error(`FATAL: ZIP not found at ${ZIP_PATH}`);
    process.exit(1);
  }
  const fd = fs.openSync(ZIP_PATH, 'r');
  const fileSize = fs.fstatSync(fd).size;
  console.log(`ZIP size: ${(fileSize / 1024 / 1024).toFixed(0)} MB`);

  const { cdOffset, cdSize } = findEndOfCentralDir(fd, fileSize);
  const cdIndex = buildCentralDirectory(fd, cdOffset, cdSize);
  console.log(`ZIP entries indexed: ${cdIndex.size}\n`);

  // Step 3: Extract per-ticker
  const tickers = {};

  for (const ticker of DLST_TICKERS) {
    // Prefer network CIK map; fall back to embedded KNOWN_CIKS
    const entry = cikMap.get(ticker);
    const cik = (entry && entry.cik) ? entry.cik : KNOWN_CIKS[ticker];

    if (!cik) {
      console.log(`  ${ticker}: no CIK`);
      tickers[ticker] = {
        error: 'no_cik',
        goodwillHistory: [], revenueHistory: [],
        goodwillLatest: null, goodwillToRev: null,
        maxGoodwillJumpPctRev: null, maxJumpYearIndex: null,
        cumDeltaGoodwillPctRev: null, cumPaymentsToRev: null,
        impairmentFlag: false,
        coverageFlags: { goodwill: false, payments: false },
      };
      continue;
    }

    const zipName  = `CIK${cik}.json`;
    const zipEntry = cdIndex.get(zipName);
    if (!zipEntry) {
      console.log(`  ${ticker} (${cik}): not in ZIP`);
      tickers[ticker] = {
        cik, error: 'not_in_zip',
        goodwillHistory: [], revenueHistory: [],
        goodwillLatest: null, goodwillToRev: null,
        maxGoodwillJumpPctRev: null, maxJumpYearIndex: null,
        cumDeltaGoodwillPctRev: null, cumPaymentsToRev: null,
        impairmentFlag: false,
        coverageFlags: { goodwill: false, payments: false },
      };
      continue;
    }

    let facts;
    try {
      const raw = readEntry(fd, zipEntry);
      const parsed = JSON.parse(raw.toString('utf8'));
      facts = (parsed.facts && parsed.facts['us-gaap']) ? parsed.facts['us-gaap'] : {};
    } catch (e) {
      console.log(`  ${ticker}: parse error — ${e.message}`);
      tickers[ticker] = {
        cik, error: e.message,
        goodwillHistory: [], revenueHistory: [],
        goodwillLatest: null, goodwillToRev: null,
        maxGoodwillJumpPctRev: null, maxJumpYearIndex: null,
        cumDeltaGoodwillPctRev: null, cumPaymentsToRev: null,
        impairmentFlag: false,
        coverageFlags: { goodwill: false, payments: false },
      };
      continue;
    }

    // ── Goodwill history (6 annuals, newest-first) ────────────────────────────
    const gwUnits  = facts['Goodwill']?.units?.['USD'] ?? null;
    const gwHist6  = pickNAnnuals(gwUnits, 6);

    // ── Revenue history (6 annuals, newest-first) ─────────────────────────────
    const revConcepts = [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet',
    ];
    let revLatest = null, revConceptUsed = null, revHist6 = [];
    for (const c of revConcepts) {
      const units = facts[c]?.units?.['USD'];
      if (!units) continue;
      const recs = pickNAnnualsRev(units, 6); // stub-period aware
      if (recs.length > 0) {
        revLatest = recs[0].val;
        revConceptUsed = c;
        revHist6 = recs;
        break;
      }
    }

    // Build a revenue lookup by fiscal year for per-year denominator (Fix 1).
    // Some companies change fiscal year end (e.g. AZTA: Sep→Dec transition creates
    // stub periods in SEC data that pollute the pickNAnnuals result with small
    // transition-period revenues). To avoid mismatches we match each goodwill
    // year to the nearest revenue record by end-date proximity (±200 days),
    // falling back to calendar-year string match, then to revLatest.
    const revByGwEnd = new Map(); // key: gwHist6[i].end, value: matched revenue
    for (const gw of gwHist6) {
      if (!gw.end) continue;
      const gwTime = new Date(gw.end).getTime();
      let bestRev = null, bestDiff = Infinity;
      for (const rv of revHist6) {
        if (!rv.end || rv.val == null) continue;
        const diff = Math.abs(new Date(rv.end).getTime() - gwTime) / 86400000;
        if (diff < bestDiff && diff <= 200) { bestDiff = diff; bestRev = rv.val; }
      }
      revByGwEnd.set(gw.end, bestRev ?? revLatest);
    }

    // ── Payments to Acquire (6 annuals, newest-first) ─────────────────────────
    const payConcepts = [
      'PaymentsToAcquireBusinessesNetOfCashAcquired',
      'PaymentsToAcquireBusinessesGross',
    ];
    let payConceptUsed = null, payHist6 = [];
    for (const c of payConcepts) {
      const units = facts[c]?.units?.['USD'];
      if (!units) continue;
      const recs = pickNAnnuals(units, 6);
      if (recs.length > 0) {
        payConceptUsed = c;
        payHist6 = recs;
        break;
      }
    }

    const goodwillLatest    = gwHist6[0] ? gwHist6[0].val : null;
    const goodwillToRev     = pct4(goodwillLatest, revLatest);

    // ── Per-year deltaGoodwill analysis (Fix 1 + Fix 2) ──────────────────────
    // For each consecutive pair in gwHist6:
    //   - compute delta = newer.val - older.val
    //   - find revenue for the NEWER year (that year's revenue, Fix 1)
    //   - if delta < 0 → impairment year (Fix 2): flag but do NOT count as deal
    //   - if delta >= 0 → positive jump; scale by that year's revenue
    //
    // maxGoodwillJumpPctRev: max of positive-only per-year (delta/thatYearRev)
    // maxJumpYearIndex:      index into gwHist6 of the newer year of the max jump
    // cumDeltaGoodwillPctRev: sum of positive per-year (delta/thatYearRev), 4+ years window
    // impairmentFlag: true if any year has delta < 0 AND |delta/thatYearRev| >= 0.05

    let maxGoodwillJumpPctRev = null;
    let maxJumpYearIndex      = null;
    let cumDeltaPositive      = 0;
    let impairmentFlag        = false;
    let hasEnoughHistory      = gwHist6.length >= 2;

    for (let i = 0; i < gwHist6.length - 1; i++) {
      const newer = gwHist6[i];
      const older = gwHist6[i + 1];
      if (newer.val == null || older.val == null) continue;

      const delta    = newer.val - older.val;
      // Use that year's revenue as denominator (Fix 1) — matched by date proximity
      const denomRev = (newer.end ? revByGwEnd.get(newer.end) : null) ?? revLatest;

      if (delta < 0) {
        // Impairment / divestiture year (Fix 2)
        if (denomRev && denomRev > 0 && Math.abs(delta) / denomRev >= 0.05) {
          impairmentFlag = true;
        }
        // Do NOT count in maxJump or cumDelta
      } else {
        // Positive jump — potential acquisition
        const jumpPct = pct4(delta, denomRev);
        if (jumpPct != null) {
          cumDeltaPositive += jumpPct;
          if (maxGoodwillJumpPctRev === null || jumpPct > maxGoodwillJumpPctRev) {
            maxGoodwillJumpPctRev = jumpPct;
            maxJumpYearIndex      = i; // index of the newer (more recent) year
          }
        }
      }
    }

    // Enforce minimum 4-year window for cumDelta to be meaningful
    const cumDeltaGoodwillPctRev = hasEnoughHistory && gwHist6.length >= 4
      ? Math.round(cumDeltaPositive * 10000) / 10000
      : null;

    // Round maxGoodwillJumpPctRev
    if (maxGoodwillJumpPctRev !== null) {
      maxGoodwillJumpPctRev = Math.round(maxGoodwillJumpPctRev * 10000) / 10000;
    }

    // ── Cumulative payments to acquire / revenue (Fix 2: clamp negatives to 0) ──
    // Sum positive payments only; divide by sum of revenue over same window.
    let payCumSum = 0;
    let revCumSum = 0;
    for (const r of payHist6) {
      if (r.val != null && r.val > 0) payCumSum += r.val;
    }
    for (const r of revHist6) {
      if (r.val != null) revCumSum += r.val;
    }
    const cumPaymentsToRev = (payCumSum > 0 && revCumSum > 0)
      ? Math.round((payCumSum / revCumSum) * 10000) / 10000
      : null;

    // ── Coverage flags ─────────────────────────────────────────────────────────
    const paymentsLatest = payHist6[0] ? payHist6[0].val : null;
    const coverageFlags = {
      goodwill:  goodwillLatest != null,
      payments:  paymentsLatest != null,
    };

    const logParts = [
      `gw=${goodwillLatest != null ? (goodwillLatest/1e9).toFixed(2)+'B' : 'NULL'}`,
      `gw/rev=${goodwillToRev != null ? (goodwillToRev*100).toFixed(0)+'%' : 'NULL'}`,
      `maxJump=${maxGoodwillJumpPctRev != null ? (maxGoodwillJumpPctRev*100).toFixed(1)+'%' : 'NULL'}`,
      `cumΔ=${cumDeltaGoodwillPctRev != null ? (cumDeltaGoodwillPctRev*100).toFixed(1)+'%' : 'NULL'}`,
      `cumPay=${cumPaymentsToRev != null ? (cumPaymentsToRev*100).toFixed(1)+'%' : 'NULL'}`,
      impairmentFlag ? 'IMPAIRMENT' : '',
    ].filter(Boolean);
    console.log(`  ${ticker.padEnd(6)}: ${logParts.join(' ')}`);

    tickers[ticker] = {
      cik,
      goodwillHistory:  gwHist6.map(r => ({ val: r.val, end: r.end })),
      revenueHistory:   revHist6.map(r => ({ val: r.val, end: r.end })),
      goodwillLatest,
      goodwillToRev,
      maxGoodwillJumpPctRev,
      maxJumpYearIndex,
      cumDeltaGoodwillPctRev,
      cumPaymentsToRev,
      impairmentFlag,
      coverageFlags,
      // Metadata for downstream use
      revConcept:      revConceptUsed,
      payConcept:      payConceptUsed,
      annualRevenue:   revLatest,
    };
  }

  fs.closeSync(fd);

  // ── Coverage stats ────────────────────────────────────────────────────────
  const tickerList = Object.values(tickers);
  const n          = tickerList.length;
  const gwPresent  = tickerList.filter(r => r.coverageFlags && r.coverageFlags.goodwill).length;
  const payPresent = tickerList.filter(r => r.coverageFlags && r.coverageFlags.payments).length;
  const gwPct      = parseFloat((gwPresent  / n * 100).toFixed(1));
  const payPct     = parseFloat((payPresent / n * 100).toFixed(1));

  // ── Header ────────────────────────────────────────────────────────────────
  const header = {
    generatedFor:        'diagnostics_lst',
    anchorDate:          ANCHOR_DATE.toISOString().slice(0, 10),
    freshnessCutoffDate: STALE_STR,
    generatedAt:         new Date().toISOString(),
    cikSource,
    tickerCount:         n,
    goodwillCoveragePct:  gwPct,
    paymentsCoveragePct:  payPct,
    note: 'Fix1: per-year revenue denominator for deltaGoodwill/rev; Fix2: negative deltaGoodwill clamped as impairment (impairmentFlag), excluded from maxJump+cumDelta; cumPaymentsToRev sums positive payments only',
  };

  const snapshot = { _header: header, ...tickers };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\nWrote: ${OUT_PATH}`);

  // ── Safety check: forbidden files untouched ──────────────────────────────
  console.log('\n── Safety check ──────────────────────────────────────────────');
  for (const fp of FORBIDDEN_PATHS) {
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      console.log(`  ${path.basename(fp)}: size=${stat.size} bytes  mtime=${stat.mtime.toISOString()}`);
    } else {
      console.log(`  ${path.basename(fp)}: not found (OK)`);
    }
  }

  // ── Coverage summary ──────────────────────────────────────────────────────
  console.log('\n── Coverage ──────────────────────────────────────────────────');
  console.log(`  Goodwill   present: ${gwPresent}/${n} = ${gwPct}%`);
  console.log(`  Payments   present: ${payPresent}/${n} = ${payPct}%`);
  console.log(`  CIK source: ${cikSource}`);

  // ── Chronic-acquirer vs organic separation ────────────────────────────────
  console.log('\n── Chronic-acquirer vs organic separation ────────────────────');
  const probeAcquirers = ['DHR', 'TMO', 'RGEN', 'AZTA', 'IQV'];
  const probeOrganic   = ['IDXX', 'EXAS', 'GH'];
  const probeCorner    = ['RVTY', 'ILMN', 'NEOG'];  // Fix validation cases

  console.log('  Chronic acquirers (expect high gw/rev + high cumDelta):');
  for (const t of probeAcquirers) {
    printProbe(t, tickers[t]);
  }
  console.log('  Organic growers (expect low gw/rev + low cumDelta):');
  for (const t of probeOrganic) {
    printProbe(t, tickers[t]);
  }
  console.log('  Fix-validation cases (RVTY+ILMN: no >100% maxJump; NEOG: impairment flag):');
  for (const t of probeCorner) {
    printProbe(t, tickers[t]);
  }

  console.log('\nDone.');
}

function printProbe(ticker, r) {
  if (!r) { console.log(`    ${ticker.padEnd(6)}: not found`); return; }
  if (r.error) { console.log(`    ${ticker.padEnd(6)}: ${r.error}`); return; }
  const gwRev  = r.goodwillToRev != null ? (r.goodwillToRev*100).toFixed(0)+'%' : 'NULL';
  const maxJ   = r.maxGoodwillJumpPctRev != null ? (r.maxGoodwillJumpPctRev*100).toFixed(1)+'%' : 'NULL';
  const cum    = r.cumDeltaGoodwillPctRev != null ? (r.cumDeltaGoodwillPctRev*100).toFixed(1)+'%' : 'NULL';
  const cumPay = r.cumPaymentsToRev != null ? (r.cumPaymentsToRev*100).toFixed(1)+'%' : 'NULL';
  const imp    = r.impairmentFlag ? ' IMPAIRMENT' : '';
  console.log(`    ${ticker.padEnd(6)}: gw/rev=${gwRev}  maxJump=${maxJ}  cumΔgw=${cum}  cumPay=${cumPay}${imp}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
