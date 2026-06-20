#!/usr/bin/env node
/**
 * Medtech M&A Goodwill Snapshot Generator
 *
 * Produces: data/ma-rpo-snapshot-medtech.json
 * NEVER touches: data/ma-rpo-snapshot.json (SaaS/Fabless — read-only)
 *
 * Data source: C:\Users\Karlr\AppData\Local\sec-xbrl-cache\companyfacts.zip
 * CIK mapping: discovery/sec-tickers.js (network) → embedded KNOWN_CIKS fallback
 * Freshness cutoff: 400 days from anchor 2026-06-20 → 2025-05-16
 *
 * ΔGoodwill-YoY is the primary inorganic-activity proxy.
 * Payments-to-acquire is secondary / control signal (~35.8% coverage).
 *
 * Reproduce:
 *   node scripts/generate-medtech-ma-snapshot.js
 *
 * Medtech universe: snapshots/<T>.json with meta.sector=="Healthcare" AND
 *   meta.industry in {Medical Devices, Medical Instruments & Supplies}
 *   MINUS {BRKR,BIO,AVTR,RGEN,AZTA,NEOG}
 *   MINUS foreign-primary / ADR / OTC non-US
 *   ~67 US-listed names
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Paths ─────────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const ZIP_PATH  = 'C:/Users/Karlr/AppData/Local/sec-xbrl-cache/companyfacts.zip';
const OUT_PATH  = path.join(REPO_ROOT, 'data', 'ma-rpo-snapshot-medtech.json');

// Safety guard — never write the old SaaS/Fabless snapshot
const FORBIDDEN_PATH = path.join(REPO_ROOT, 'data', 'ma-rpo-snapshot.json');

// ── Freshness cutoff ──────────────────────────────────────────────────────────
const ANCHOR_DATE  = new Date('2026-06-20');
const STALE_CUTOFF = new Date(ANCHOR_DATE);
STALE_CUTOFF.setDate(STALE_CUTOFF.getDate() - 400);
const STALE_STR = STALE_CUTOFF.toISOString().slice(0, 10); // '2025-05-16'

// ── Medtech universe ──────────────────────────────────────────────────────────
// Healthcare / Medical Devices + Instruments; minus tools/life-science-tools;
// minus foreign-primary ADRs (.T/.HK/.AX/.SW); US-listed foreign OK (PHG/SNN/LIVN)
const MEDTECH_TICKERS = [
  'ABT','AHCO','ALC','ALGN','ALMR','AORT','ATEC','ATR','ATRC','AVNS',
  'AXGN','BAX','BDX','BFLY','BIO-B','BLCO','BLFS','BSX','CNMD','COO',
  'DXCM','ENOV','ESTA','EW','GEHC','GKOS','GMED','HAE','IART','ICUI',
  'INMD','INSP','IRMD','IRTC','ISRG','ITGR','KMTS','LIVN','LMAT','MASI',
  'MDLN','MDT','MMED','MMSI','NVCR','NVST','PEN','PHG','PLSE','PODD',
  'PRCT','QDEL','RMD','SNN','SOLV','STAA','STE','STVN','SYK','TFX',
  'TMDX','TNDM','UFPT','WRBY','WST','XRAY','ZBH'
];

// ── Embedded CIK map (fallback when network is unavailable) ──────────────────
// Sourced from _medtech-ma-coverage.js network run on 2026-06-20
// Key = ticker, value = 10-digit zero-padded CIK string
const KNOWN_CIKS = {
  'ABT':   '0000001800', 'AHCO':  '0001725255', 'ALC':   '0001167379',
  'ALGN':  '0001097149', 'ALMR':  '0002104204', 'AORT':  '0000784199',
  'ATEC':  '0001350653', 'ATR':   '0000896622', 'ATRC':  '0001323885',
  'AVNS':  '0001606498', 'AXGN':  '0000805928', 'BAX':   '0000010456',
  'BDX':   '0000010795', 'BFLY':  '0001804176', 'BIO-B': '0000012208',
  'BLCO':  '0001860742', 'BLFS':  '0000834365', 'BSX':   '0000885725',
  'CNMD':  '0000816956', 'COO':   '0000711404', 'DXCM':  '0001093557',
  'ENOV':  '0001420800', 'ESTA':  '0001688757', 'EW':    '0001099800',
  'GEHC':  '0001932393', 'GKOS':  '0001192448', 'GMED':  '0001237831',
  'HAE':   '0000313143', 'IART':  '0000917520', 'ICUI':  '0000883984',
  'INMD':  '0001742692', 'INSP':  '0001609550', 'IRMD':  '0001325618',
  'IRTC':  '0001388658', 'ISRG':  '0001035267', 'ITGR':  '0001114483',
  'KMTS':  '0001877184', 'LIVN':  '0001639691', 'LMAT':  '0001158895',
  'MASI':  '0000937556', 'MDLN':  '0002046386', 'MDT':   '0001613103',
  'MMED':  '0002062583', 'MMSI':  '0000856982', 'NVCR':  '0001645113',
  'NVST':  '0001757073', 'PEN':   '0001321732', 'PHG':   '0000313216',
  'PLSE':  '0001625101', 'PODD':  '0001145197', 'PRCT':  '0001588978',
  'QDEL':  '0001906324', 'RMD':   '0000943819', 'SNN':   '0000845982',
  'SOLV':  '0001964738', 'STAA':  '0000718937', 'STE':   '0001757898',
  'STVN':  '0001849853', 'SYK':   '0000310764', 'TFX':   '0000096943',
  'TMDX':  '0001756262', 'TNDM':  '0001438133', 'UFPT':  '0000914156',
  'WRBY':  '0001504776', 'WST':   '0000105770', 'XRAY':  '0000818479',
  'ZBH':   '0001136869',
};

// ── V0 Gate-Durchläufer (14 Ticker) for final report ─────────────────────────
const V0_GATE = [
  'ABT','BSX','SYK','MDT','GMED','EW','BDX','ZBH',
  'STE','ISRG','PODD','TMDX','RMD','HAE'
];

// ── ZIP parser (same mechanics as extract-ma-rpo.js) ─────────────────────────
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
          if (localOffset=== 0xFFFFFFFF) { localOffset = Number(cdBuf.readBigUInt64LE(z64pos)); }
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

// Returns { val, end, form } for the latest non-stale annual (10-K/10-K/A/20-F/40-F)
function pickBestAnnual(unitArr) {
  if (!Array.isArray(unitArr)) return null;
  const annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
  for (const u of annuals) {
    if (!isStale(u.end)) return { val: u.val, end: u.end, form: u.form };
  }
  return null;
}

// Returns { val, end, form } for the annual filing ~1 year before the latest
function pickPriorAnnual(unitArr) {
  if (!Array.isArray(unitArr)) return null;
  const annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));

  let latestIdx = -1;
  for (let i = 0; i < annuals.length; i++) {
    if (!isStale(annuals[i].end)) { latestIdx = i; break; }
  }
  if (latestIdx < 0) return null;

  const latestTime = new Date(annuals[latestIdx].end).getTime();
  // Prefer a filing 270–550 days before the latest (≈1 fiscal year)
  for (let i = latestIdx + 1; i < annuals.length; i++) {
    const diffDays = (latestTime - new Date(annuals[i].end).getTime()) / 86400000;
    if (diffDays >= 270 && diffDays <= 550) {
      return { val: annuals[i].val, end: annuals[i].end, form: annuals[i].form };
    }
  }
  // Fallback: next available annual
  if (annuals[latestIdx + 1]) {
    const u = annuals[latestIdx + 1];
    return { val: u.val, end: u.end, form: u.form };
  }
  return null;
}

// Returns the last N non-stale annual goodwill records (newest-first), deduplicated by fiscal year.
// Used for the 3-year jump detector (Fix 1 v1.1).
function pickNAnnuals(unitArr, n) {
  if (!Array.isArray(unitArr)) return [];
  const annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));

  // Find index of the latest non-stale annual
  let latestIdx = -1;
  for (let i = 0; i < annuals.length; i++) {
    if (!isStale(annuals[i].end)) { latestIdx = i; break; }
  }
  if (latestIdx < 0) return [];

  // Deduplicate: keep one record per fiscal year (by calendar year of end date)
  // Prefer 10-K over 10-K/A (already handled by sort since end dates match)
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

// Computes max(ΔGoodwill[t] / Revenue[t]) over the goodwill history window vs a revenue series.
// gwHistory = [{ val, end }] newest-first (≥2 entries required).
// revLatest = most recent annual revenue (used as denominator for all jumps — conservative).
// Returns null if insufficient data.
function computeMaxGoodwillJumpPctRev(gwHistory, revLatest) {
  if (!gwHistory || gwHistory.length < 2 || revLatest == null || revLatest === 0) return null;
  let maxJump = null;
  for (let i = 0; i < gwHistory.length - 1; i++) {
    const newer = gwHistory[i].val;
    const older = gwHistory[i + 1].val;
    if (newer == null || older == null) continue;
    const jump = (newer - older) / revLatest;
    if (maxJump === null || jump > maxJump) maxJump = jump;
  }
  return maxJump != null ? Math.round(maxJump * 10000) / 10000 : null;
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
  // Embedded fallback: CIKs sourced from _medtech-ma-coverage.js network run 2026-06-20
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
  if (OUT_PATH === FORBIDDEN_PATH) {
    console.error('FATAL: OUT_PATH would overwrite the forbidden SaaS/Fabless snapshot!');
    process.exit(1);
  }

  console.log('=== Medtech M&A Goodwill Snapshot Generator ===');
  console.log(`Anchor date:     ${ANCHOR_DATE.toISOString().slice(0,10)}`);
  console.log(`Freshness cutoff: ${STALE_STR} (400-day window)`);
  console.log(`Universe:        ${MEDTECH_TICKERS.length} tickers`);
  console.log(`Output:          ${OUT_PATH}`);
  console.log(`Forbidden (read-only guard): ${FORBIDDEN_PATH}\n`);

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

  for (const ticker of MEDTECH_TICKERS) {
    const entry = cikMap.get(ticker);
    if (!entry || !entry.cik) {
      console.log(`  ${ticker}: no CIK`);
      tickers[ticker] = {
        error: 'no_cik',
        goodwillLatest: null, goodwillLatestEnd: null,
        goodwillPrior: null,  goodwillPriorEnd: null,
        deltaGoodwill: null,  deltaGoodwillPctRev: null,
        annualRevenue: null,
        paymentsToAcquire: null, paymentsToRev: null,
        coverageFlags: { goodwill: false, payments: false },
        staleFlag: false,
      };
      continue;
    }

    const cik = entry.cik;
    const zipName = `CIK${cik}.json`;
    const zipEntry = cdIndex.get(zipName);
    if (!zipEntry) {
      console.log(`  ${ticker} (${cik}): not in ZIP`);
      tickers[ticker] = {
        cik,
        error: 'not_in_zip',
        goodwillLatest: null, goodwillLatestEnd: null,
        goodwillPrior: null,  goodwillPriorEnd: null,
        deltaGoodwill: null,  deltaGoodwillPctRev: null,
        annualRevenue: null,
        paymentsToAcquire: null, paymentsToRev: null,
        coverageFlags: { goodwill: false, payments: false },
        staleFlag: false,
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
        cik,
        error: e.message,
        goodwillLatest: null, goodwillLatestEnd: null,
        goodwillPrior: null,  goodwillPriorEnd: null,
        deltaGoodwill: null,  deltaGoodwillPctRev: null,
        annualRevenue: null,
        paymentsToAcquire: null, paymentsToRev: null,
        coverageFlags: { goodwill: false, payments: false },
        staleFlag: false,
      };
      continue;
    }

    // ── Goodwill ──────────────────────────────────────────────────────────────
    const gwUnits = facts['Goodwill']?.units?.['USD'] ?? null;
    const gwLatestRec = pickBestAnnual(gwUnits);
    const gwPriorRec  = pickPriorAnnual(gwUnits);

    const goodwillLatest    = gwLatestRec ? gwLatestRec.val : null;
    const goodwillLatestEnd = gwLatestRec ? gwLatestRec.end : null;
    const goodwillPrior     = gwPriorRec  ? gwPriorRec.val  : null;
    const goodwillPriorEnd  = gwPriorRec  ? gwPriorRec.end  : null;

    // staleFlag: goodwill data exists but all annuals are stale
    const staleFlag = (gwUnits && gwUnits.length > 0 && goodwillLatest == null);

    const deltaGoodwill = (goodwillLatest != null && goodwillPrior != null)
      ? Math.round(goodwillLatest - goodwillPrior) : null;

    // v1.1 Fix 1: 3-year goodwill history for jump detection
    // Fetch up to 4 annuals (newest-first) to cover a ~3-year window of YoY jumps
    const gwHistory4 = pickNAnnuals(gwUnits, 4);

    // ── Revenue ───────────────────────────────────────────────────────────────
    const revConcepts = [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet',
    ];
    let revLatest = null, revConceptUsed = null;
    for (const c of revConcepts) {
      const units = facts[c]?.units?.['USD'];
      if (!units) continue;
      const rec = pickBestAnnual(units);
      if (rec) { revLatest = rec.val; revConceptUsed = c; break; }
    }

    const deltaGoodwillPctRev = pct4(deltaGoodwill, revLatest);

    // v1.1 Fix 1: max goodwill jump over 3-year window (uses revLatest as denominator)
    const maxGoodwillJumpPctRev = computeMaxGoodwillJumpPctRev(gwHistory4, revLatest);

    // ── Payments to Acquire ───────────────────────────────────────────────────
    const payConcepts = [
      'PaymentsToAcquireBusinessesNetOfCashAcquired',
      'PaymentsToAcquireBusinessesGross',
    ];
    let paymentsToAcquire = null, payConceptUsed = null;
    for (const c of payConcepts) {
      const units = facts[c]?.units?.['USD'];
      if (!units) continue;
      const rec = pickBestAnnual(units);
      if (rec) { paymentsToAcquire = rec.val; payConceptUsed = c; break; }
    }
    const paymentsToRev = pct4(paymentsToAcquire, revLatest);

    // ── Coverage flags ────────────────────────────────────────────────────────
    const coverageFlags = {
      goodwill:  goodwillLatest != null,
      payments:  paymentsToAcquire != null,
    };

    // v1.1: condensed goodwill history for downstream jump detection
    const goodwillHistory = gwHistory4.map(r => ({ val: r.val, end: r.end }));

    const logParts = [
      `gw=${goodwillLatest != null ? (goodwillLatest/1e9).toFixed(2)+'B' : 'NULL'}`,
      `Δgw=${deltaGoodwill  != null ? (deltaGoodwill/1e9).toFixed(3)+'B' : 'NULL'}`,
      `ΔgwRev=${deltaGoodwillPctRev != null ? (deltaGoodwillPctRev*100).toFixed(1)+'%' : 'NULL'}`,
      `maxJump=${maxGoodwillJumpPctRev != null ? (maxGoodwillJumpPctRev*100).toFixed(1)+'%' : 'NULL'}`,
      `pay=${paymentsToAcquire != null ? (paymentsToAcquire/1e6).toFixed(0)+'M' : 'NULL'}`,
      `rev=${revLatest != null ? (revLatest/1e9).toFixed(2)+'B' : 'NULL'}`,
    ];
    console.log(`  ${ticker.padEnd(6)}: ${logParts.join(' ')}`);

    tickers[ticker] = {
      cik,
      goodwillLatest,
      goodwillLatestEnd,
      goodwillPrior,
      goodwillPriorEnd,
      deltaGoodwill,
      deltaGoodwillPctRev,
      maxGoodwillJumpPctRev,
      goodwillHistory,
      annualRevenue:     revLatest,
      revConcept:        revConceptUsed,
      paymentsToAcquire,
      payConcept:        payConceptUsed,
      paymentsToRev,
      coverageFlags,
      staleFlag,
    };
  }

  fs.closeSync(fd);

  // ── Coverage stats ────────────────────────────────────────────────────────
  const tickerList = Object.values(tickers);
  const n          = tickerList.length;
  const gwPresent  = tickerList.filter(r => r.coverageFlags && r.coverageFlags.goodwill).length;
  const payPresent = tickerList.filter(r => r.coverageFlags && r.coverageFlags.payments).length;
  const gwPct  = parseFloat((gwPresent  / n * 100).toFixed(1));
  const payPct = parseFloat((payPresent / n * 100).toFixed(1));

  // ── Header / metadata ────────────────────────────────────────────────────
  const header = {
    generatedFor:        'medtech_devices',
    anchorDate:          ANCHOR_DATE.toISOString().slice(0, 10),
    freshnessCutoffDate: STALE_STR,
    generatedAt:         new Date().toISOString(),
    cikSource,
    tickerCount:         n,
    goodwillCoveragePct:  gwPct,
    paymentsCoveragePct:  payPct,
    note: 'v1.1: maxGoodwillJumpPctRev (3yr window) + goodwillHistory added; delta-goodwill primary inorganic proxy; payments control-only (35.8% cov expected)',
  };

  // ── Final snapshot ────────────────────────────────────────────────────────
  const snapshot = { _header: header, ...tickers };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\nWrote: ${OUT_PATH}`);

  // ── Validation: confirm forbidden file untouched ─────────────────────────
  console.log('\n── Safety check ────────────────────────────────────────────');
  if (fs.existsSync(FORBIDDEN_PATH)) {
    const stat = fs.statSync(FORBIDDEN_PATH);
    console.log(`  data/ma-rpo-snapshot.json: size=${stat.size} bytes  mtime=${stat.mtime.toISOString()}`);
    console.log('  (verify this matches pre-run values to confirm it is untouched)');
  } else {
    console.log('  data/ma-rpo-snapshot.json: not found (OK — was never there)');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Coverage ─────────────────────────────────────────────────');
  console.log(`  Goodwill   present: ${gwPresent}/${n} = ${gwPct}%`);
  console.log(`  Payments   present: ${payPresent}/${n} = ${payPct}%`);
  console.log(`  CIK source: ${cikSource}`);

  // ── V0 Gate Durchläufer detail ────────────────────────────────────────────
  console.log('\n── V0 Gate-Durchläufer (deltaGoodwillPctRev + maxGoodwillJumpPctRev) ──');
  for (const t of V0_GATE) {
    const r = tickers[t];
    if (!r) { console.log(`  ${t.padEnd(6)}: not in universe`); continue; }
    const dgw = r.deltaGoodwill != null ? (r.deltaGoodwill/1e9).toFixed(3)+'B' : 'NULL';
    const dgwR = r.deltaGoodwillPctRev != null ? (r.deltaGoodwillPctRev*100).toFixed(2)+'%rev' : 'NULL';
    const maxJ = r.maxGoodwillJumpPctRev != null ? (r.maxGoodwillJumpPctRev*100).toFixed(2)+'%rev' : 'NULL';
    const gw   = r.goodwillLatest != null ? (r.goodwillLatest/1e9).toFixed(2)+'B' : 'NULL';
    const hist = (r.goodwillHistory || []).map(h => `${h.end}:${h.val!=null?(h.val/1e9).toFixed(2)+'B':'NULL'}`).join(' ');
    console.log(`  ${t.padEnd(6)}: ΔGW=${dgw} (${dgwR})  maxJump=${maxJ}  gwLatest=${gw}  history=[${hist}]`);
  }

  // ── GMED vs organic probe ─────────────────────────────────────────────────
  console.log('\n── GMED vs Organic probe (v1.1 jump detector) ──────────────');
  const probeNames = ['GMED','ISRG','PODD','TMDX'];
  for (const t of probeNames) {
    const r = tickers[t];
    if (!r) { console.log(`  ${t}: not found`); continue; }
    const dgwR = r.deltaGoodwillPctRev != null ? (r.deltaGoodwillPctRev*100).toFixed(2)+'%rev' : 'NULL';
    const maxJ = r.maxGoodwillJumpPctRev != null ? (r.maxGoodwillJumpPctRev*100).toFixed(2)+'%rev' : 'NULL';
    const jumpFires = r.maxGoodwillJumpPctRev != null && r.maxGoodwillJumpPctRev >= 0.25;
    const tag  = t === 'GMED' ? '← M&A acquirer (NuVasive)' : '← organic grower';
    console.log(`  ${t.padEnd(6)}: ΔGW%Rev=${dgwR}  maxJump=${maxJ}  jump-detector=${jumpFires?'FIRES':'no'}  ${tag}`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
