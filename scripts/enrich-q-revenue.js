#!/usr/bin/env node
/**
 * enrich-q-revenue.js — write SEC quarterly-revenue YoY series into fundamentals-cache.
 *
 * Solution-(c) for the fabless Durability axis (Iteration 10 retrial, durability v3):
 * the local Yahoo ftsQuarterly.revenueQ caps at ~5 quarters (1 YoY point), too thin for a
 * robust durability metric. SEC companyfacts.zip carries full filing history. This script
 * extracts the quarterly revenue series per ticker, computes proper q_t/q_{t-4}-1 YoY, and
 * writes it as payload.ftsQuarterly.revQYoYsec (NEWEST-first plain numbers) into each
 * fundamentals-cache/{TICKER}.json — consumed by court-screen.js durability v3.
 *
 * Deterministic (no Date.now/Math.random; only new Date(<fixed string>) for period math).
 * Idempotent: re-running overwrites only revQYoYsec (+ revQYoYsecMeta), preserves the file.
 * Freshness-first concept selection (avoids the MXL SalesRevenueNet-stale-2018 trap).
 *
 * Usage: node scripts/enrich-q-revenue.js [TICKER ...]   (default: 8 fabless_semi members)
 * Source: C:/Users/Karlr/AppData/Local/sec-xbrl-cache/companyfacts.zip
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// F-A-2026-06-21 (audit): route the cache write through the repo's atomic writer so a
// SIGKILL/CI-timeout mid-write can't truncate a court-screen input file (Pattern D).
const { writeFileAtomic } = require('../lib/atomic-write.js');

const ZIP_PATH = 'C:/Users/Karlr/AppData/Local/sec-xbrl-cache/companyfacts.zip';
const CACHE = path.join(__dirname, '..', 'fundamentals-cache');
const STORE_CAP = 20; // store up to 20 newest YoY points (court-screen windows to 12)
const DEFAULT_TICKERS = ['CRDO', 'ALAB', 'NVDA', 'ARM', 'AMBA', 'AVGO', 'AMD', 'MXL'];
const REV_CONCEPTS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
];

// ── ZIP central-directory parser (verbatim from extract-ma-rpo.js / _probe-q-revenue.js) ──
function readUInt32LE(buf, o) { return buf.readUInt32LE(o); }
function readUInt16LE(buf, o) { return buf.readUInt16LE(o); }
function findEndOfCentralDir(fd, fileSize) {
  const scanSize = Math.min(65557, fileSize);
  const buf = Buffer.alloc(scanSize);
  fs.readSync(fd, buf, 0, scanSize, fileSize - scanSize);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const cdOffset = readUInt32LE(buf, i + 16), cdSize = readUInt32LE(buf, i + 12), cdCount = readUInt16LE(buf, i + 10);
      if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) return findEndOfCentralDir64(fd, fileSize, (fileSize - scanSize) + i);
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
  return { cdSize: Number(eocd64Buf.readBigUInt64LE(40)), cdOffset: Number(eocd64Buf.readBigUInt64LE(48)), cdCount: Number(eocd64Buf.readBigUInt64LE(24)) };
}
function buildCentralDirectory(fd, cdOffset, cdSize) {
  const cdBuf = Buffer.alloc(cdSize);
  fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);
  const index = new Map();
  let pos = 0;
  while (pos < cdBuf.length - 4) {
    if (cdBuf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = readUInt16LE(cdBuf, pos + 10), compSize = readUInt32LE(cdBuf, pos + 20), uncompSize = readUInt32LE(cdBuf, pos + 24);
    const fnLen = readUInt16LE(cdBuf, pos + 28), extraLen = readUInt16LE(cdBuf, pos + 30), commentLen = readUInt16LE(cdBuf, pos + 32);
    let localOffset = readUInt32LE(cdBuf, pos + 42);
    const fileName = cdBuf.subarray(pos + 46, pos + 46 + fnLen).toString('utf8');
    if (localOffset === 0xFFFFFFFF) {
      const extraStart = pos + 46 + fnLen; let ep = extraStart;
      while (ep < extraStart + extraLen - 3) {
        const hid = cdBuf.readUInt16LE(ep), hlen = cdBuf.readUInt16LE(ep + 2);
        if (hid === 0x0001) {
          let z64pos = ep + 4, z64uncompSize = uncompSize, z64compSize = compSize, z64localOffset = localOffset;
          if (uncompSize === 0xFFFFFFFF) { z64uncompSize = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          if (compSize === 0xFFFFFFFF) { z64compSize = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          if (localOffset === 0xFFFFFFFF) { z64localOffset = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          index.set(fileName, { localHeaderOffset: z64localOffset, compSize: z64compSize, uncompSize: z64uncompSize, method });
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
  const dataOffset = entry.localHeaderOffset + 30 + readUInt16LE(lhBuf, 26) + readUInt16LE(lhBuf, 28);
  const compBuf = Buffer.alloc(entry.compSize);
  fs.readSync(fd, compBuf, 0, entry.compSize, dataOffset);
  if (entry.method === 0) return compBuf;
  if (entry.method === 8) return zlib.inflateRawSync(compBuf);
  throw new Error('Unsupported compression method: ' + entry.method);
}

// ── Quarterly revenue extraction (verbatim from _probe-q-revenue.js) ──
function isQuarterlyPoint(u) {
  const fp = (u.fp || '').toUpperCase(), form = (u.form || '').toUpperCase();
  if (fp === 'Q1' || fp === 'Q2' || fp === 'Q3') return true;
  if (fp === 'Q4' && (form === '10-Q' || form === '10-Q/A')) return true;
  if (!u.start || !u.end) return false;
  const days = (new Date(u.end) - new Date(u.start)) / 86400000;
  return days >= 80 && days <= 110;
}
// audit F-A-2026-06-21: an FY/annual point is the ~365-day 10-K YTD figure. The discrete-Q4
// extractor (isQuarterlyPoint) deliberately excludes it; we capture it separately so Q4 can be
// reconstructed by subtraction (annual − Q1 − Q2 − Q3) rather than left as a permanent hole.
function isAnnualPoint(u) {
  if (!u.start || !u.end) return false;
  const days = (new Date(u.end) - new Date(u.start)) / 86400000;
  return days >= 340 && days <= 400;
}
function extractQuarterlyPoints(unitArr) {
  if (!Array.isArray(unitArr)) return [];
  const quarterly = unitArr.filter(u => u && u.val != null && u.end && isQuarterlyPoint(u));
  const byEnd = new Map();
  for (const u of quarterly) {
    const ex = byEnd.get(u.end);
    if (!ex || (u.accn || '') > (ex.accn || '')) byEnd.set(u.end, u);
  }
  // audit F-A-2026-06-21: prevents the systematic Q4-missing failure mode — without this the
  // YoY series has an annual hole (no q_t finds a ~365d-prior Q4 partner), thinning durability.
  // Reconstruct each missing discrete Q4 by subtraction, strictly within this single concept's
  // unit array (no cross-concept mixing). For an annual (~365d) point we sum the three discrete
  // quarters whose ends fall inside its (start, end] window; only when ALL THREE exist do we
  // synthesize Q4 = annual − (Q1+Q2+Q3). If any prior is absent we leave the hole rather than guess.
  const annuals = new Map();
  for (const u of unitArr) {
    if (!u || u.val == null || !u.start || !u.end || !isAnnualPoint(u)) continue;
    const ex = annuals.get(u.end);
    if (!ex || (u.accn || '') > (ex.accn || '')) annuals.set(u.end, u);
  }
  for (const a of annuals.values()) {
    if (byEnd.has(a.end)) continue; // a real (e.g. 10-Q) discrete Q4 already exists — don't clobber it
    const aStart = new Date(a.start).getTime(), aEnd = new Date(a.end).getTime();
    const priors = [];
    for (const q of byEnd.values()) {
      const qEnd = new Date(q.end).getTime();
      if (qEnd > aStart && qEnd < aEnd) priors.push(q);
    }
    if (priors.length !== 3) continue; // need exactly Q1+Q2+Q3 of this fiscal year, else skip
    const sum123 = priors.reduce((s, q) => s + q.val, 0);
    byEnd.set(a.end, { end: a.end, val: a.val - sum123, accn: a.accn });
  }
  return [...byEnd.values()].sort((a, b) => a.end < b.end ? -1 : a.end > b.end ? 1 : 0).map(u => ({ end: u.end, val: u.val }));
}
function quarterlyYoY(pts) {
  const result = [];
  for (let i = 0; i < pts.length; i++) {
    const currDate = new Date(pts[i].end);
    let best = null, bestDiff = Infinity;
    for (let j = 0; j < i; j++) {
      const diff = (currDate - new Date(pts[j].end)) / 86400000;
      if (diff >= 340 && diff <= 400) { const ad = Math.abs(diff - 365); if (ad < bestDiff) { best = pts[j]; bestDiff = ad; } }
    }
    if (best && best.val > 0) result.push({ end: pts[i].end, yoy: (pts[i].val / best.val) - 1 });
  }
  return result; // oldest -> newest
}

function main() {
  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TICKERS;
  const { fetchSecTickers } = require('../discovery/sec-tickers.js');

  console.log('=== enrich-q-revenue.js ===');
  return fetchSecTickers().then(tickerMap => {
    const fd = fs.openSync(ZIP_PATH, 'r');
    const { cdOffset, cdSize } = findEndOfCentralDir(fd, fs.fstatSync(fd).size);
    const cdIndex = buildCentralDirectory(fd, cdOffset, cdSize);
    console.log('Indexed', cdIndex.size, 'companyfacts entries\n');

    let wrote = 0;
    for (const ticker of tickers) {
      const entry = tickerMap.get(ticker);
      if (!entry || !entry.cik) { console.warn(`[skip] ${ticker}: no CIK`); continue; }
      const zipEntry = cdIndex.get(`CIK${entry.cik}.json`);
      if (!zipEntry) { console.warn(`[skip] ${ticker}: not in zip (CIK${entry.cik})`); continue; }

      let facts;
      try { facts = (JSON.parse(readEntry(fd, zipEntry).toString('utf8')).facts || {})['us-gaap'] || {}; }
      catch (e) { console.warn(`[skip] ${ticker}: ${e.message}`); continue; }

      // Freshness-first concept selection (pick concept with the most-recent quarterly point)
      let qPts = [], conceptUsed = null, bestLatestEnd = '';
      for (const c of REV_CONCEPTS) {
        const cf = facts[c];
        if (!cf || !cf.units || !cf.units['USD']) continue;
        const pts = extractQuarterlyPoints(cf.units['USD']);
        if (!pts.length) continue;
        const latest = pts[pts.length - 1].end;
        if (latest > bestLatestEnd) { qPts = pts; conceptUsed = c; bestLatestEnd = latest; }
      }
      const yoy = quarterlyYoY(qPts);                 // oldest->newest
      const newestFirst = yoy.map(y => Math.round(y.yoy * 1e6) / 1e6).reverse().slice(0, STORE_CAP);
      if (!newestFirst.length) { console.warn(`[skip] ${ticker}: no quarterly YoY`); continue; }

      const cacheFile = path.join(CACHE, `${ticker}.json`);
      if (!fs.existsSync(cacheFile)) { console.warn(`[skip] ${ticker}: no cache file`); continue; }
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (!j.payload) { console.warn(`[skip] ${ticker}: no payload`); continue; }
      j.payload.ftsQuarterly = j.payload.ftsQuarterly || {};
      j.payload.ftsQuarterly.revQYoYsec = newestFirst;
      j.payload.ftsQuarterly.revQYoYsecMeta = { source: 'sec-companyfacts', concept: conceptUsed, cik: entry.cik, yoyPairsAvail: yoy.length, latestEnd: bestLatestEnd, script: 'enrich-q-revenue.js' };
      writeFileAtomic(cacheFile, JSON.stringify(j));
      wrote++;
      console.log(`${ticker.padEnd(6)} concept=${conceptUsed} avail=${String(yoy.length).padStart(2)} stored=${newestFirst.length} latest=${bestLatestEnd}  YoY(newest-first)=${JSON.stringify(newestFirst.slice(0, 6).map(v => Math.round(v * 100) + '%'))}`);
    }
    fs.closeSync(fd);
    console.log(`\n[done] enriched ${wrote}/${tickers.length} fundamentals-cache files with payload.ftsQuarterly.revQYoYsec`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
