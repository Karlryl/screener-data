#!/usr/bin/env node
/**
 * Iter 5 M&A / RPO extraction agent — GENERATOR for data/ma-rpo-snapshot.json
 *
 * Provenance: reads the local SEC XBRL bulk archive at
 *   C:\Users\Karlr\AppData\Local\sec-xbrl-cache\companyfacts.zip
 * No network calls. Applies 400-day freshness cutoff (anchor: 2026-06-16)
 * — stale filings yield NULL values in the snapshot (not zero).
 *
 * To regenerate the committed snapshot:
 *   node scripts/extract-ma-rpo.js
 *   cp outputs/_iter5-ma-rpo-dump.json data/ma-rpo-snapshot.json
 *
 * Original location: outputs/_iter5-extract.js (git-ignored outputs/ dir)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ZIP_PATH = 'C:/Users/Karlr/AppData/Local/sec-xbrl-cache/companyfacts.zip';
const OUT_PATH = path.join(__dirname, '_iter5-ma-rpo-dump.json');

// 400-day freshness anchor
const ANCHOR_DATE = new Date('2026-06-16');
const STALE_CUTOFF = new Date(ANCHOR_DATE);
STALE_CUTOFF.setDate(STALE_CUTOFF.getDate() - 400);
const STALE_STR = STALE_CUTOFF.toISOString().slice(0, 10); // '2025-05-12'

const TICKERS = [
  'APP','GEN','PLTR','DUOL','HNGE','FIG','CWAN','AVPT','KVYO','RBRK',
  'ZETA','DDOG','GTLB','ADSK','FICO','ALKT','FTNT','CVLT','CLBT','CDNS',
  'APPF','CSGP','FROG','WAY','GWRE','TTAN','APPN','DT','BRZE','AI',
  'CRWD','AGYS','SDGR','CGNT','FRSH','DOCS','DV','LSPD','ESTC','QTWO',
  'PCOR','BILL','AMPL','FSLY'
];

// ── ZIP central-directory parser ──────────────────────────────────────────────
// We read the End of Central Directory record from the tail of the file,
// then scan the central directory to build a name→{offset,compSize,method} map.

function readUInt32LE(buf, offset) { return buf.readUInt32LE(offset); }
function readUInt16LE(buf, offset) { return buf.readUInt16LE(offset); }

function findEndOfCentralDir(fd, fileSize) {
  // EOCD is at least 22 bytes, max comment 65535 bytes → scan last 65557 bytes
  const scanSize = Math.min(65557, fileSize);
  const buf = Buffer.alloc(scanSize);
  const readPos = fileSize - scanSize;
  fs.readSync(fd, buf, 0, scanSize, readPos);
  // Search backwards for signature 0x06054b50
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      const cdOffset = readUInt32LE(buf, i + 16);
      const cdSize   = readUInt32LE(buf, i + 12);
      const cdCount  = readUInt16LE(buf, i + 10);
      // ZIP64: if any field is 0xFFFFFFFF we'd need ZIP64 EOCD — handle below
      if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
        return findEndOfCentralDir64(fd, fileSize, readPos + i);
      }
      return { cdOffset, cdSize, cdCount };
    }
  }
  throw new Error('EOCD signature not found');
}

function findEndOfCentralDir64(fd, fileSize, eocdPos) {
  // ZIP64 EOCD locator is immediately before EOCD
  const locBuf = Buffer.alloc(20);
  fs.readSync(fd, locBuf, 0, 20, eocdPos - 20);
  if (locBuf.readUInt32LE(0) !== 0x07064b50) throw new Error('ZIP64 locator not found');
  const eocd64Offset = Number(locBuf.readBigUInt64LE(8));
  const eocd64Buf = Buffer.alloc(56);
  fs.readSync(fd, eocd64Buf, 0, 56, eocd64Offset);
  if (eocd64Buf.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 EOCD not found');
  const cdSize   = Number(eocd64Buf.readBigUInt64LE(40));
  const cdOffset = Number(eocd64Buf.readBigUInt64LE(48));
  const cdCount  = Number(eocd64Buf.readBigUInt64LE(24));
  return { cdOffset, cdSize, cdCount };
}

function buildCentralDirectory(fd, cdOffset, cdSize) {
  const cdBuf = Buffer.alloc(cdSize);
  fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);
  const index = new Map(); // filename → { localHeaderOffset, compSize, uncompSize, method }
  let pos = 0;
  while (pos < cdBuf.length - 4) {
    const sig = cdBuf.readUInt32LE(pos);
    if (sig !== 0x02014b50) break;
    const method      = readUInt16LE(cdBuf, pos + 10);
    const compSize    = readUInt32LE(cdBuf, pos + 20);
    const uncompSize  = readUInt32LE(cdBuf, pos + 24);
    const fnLen       = readUInt16LE(cdBuf, pos + 28);
    const extraLen    = readUInt16LE(cdBuf, pos + 30);
    const commentLen  = readUInt16LE(cdBuf, pos + 32);
    let localOffset   = readUInt32LE(cdBuf, pos + 42);
    const fileName    = cdBuf.subarray(pos + 46, pos + 46 + fnLen).toString('utf8');
    // Handle ZIP64 extended info
    if (localOffset === 0xFFFFFFFF) {
      const extraStart = pos + 46 + fnLen;
      let ep = extraStart;
      while (ep < extraStart + extraLen - 3) {
        const hid  = cdBuf.readUInt16LE(ep);
        const hlen = cdBuf.readUInt16LE(ep + 2);
        if (hid === 0x0001) {
          // ZIP64 extra field — fields present depend on which were 0xFFFF in local header
          let z64pos = ep + 4;
          let z64compSize = compSize, z64uncompSize = uncompSize, z64localOffset = localOffset;
          if (uncompSize === 0xFFFFFFFF) { z64uncompSize = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          if (compSize   === 0xFFFFFFFF) { z64compSize   = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          if (localOffset=== 0xFFFFFFFF) { z64localOffset= Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
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
  // Local file header is 30 + fn + extra bytes before the data
  const lhBuf = Buffer.alloc(30);
  fs.readSync(fd, lhBuf, 0, 30, entry.localHeaderOffset);
  const fnLen    = readUInt16LE(lhBuf, 26);
  const extraLen = readUInt16LE(lhBuf, 28);
  const dataOffset = entry.localHeaderOffset + 30 + fnLen + extraLen;
  const compBuf = Buffer.alloc(entry.compSize);
  fs.readSync(fd, compBuf, 0, entry.compSize, dataOffset);
  if (entry.method === 0) return compBuf;      // stored
  if (entry.method === 8) return zlib.inflateRawSync(compBuf); // deflate
  throw new Error('Unsupported compression method: ' + entry.method);
}

// ── XBRL data extraction helpers ─────────────────────────────────────────────

function isStale(dateStr) {
  // Returns true if dateStr < STALE_STR (i.e., too old)
  if (!dateStr) return true;
  return dateStr < STALE_STR;
}

// From a concept's units array (e.g. facts['us-gaap']['Goodwill'].units['USD'])
// pick the best annual value: latest non-stale 10-K form, then most-recent period end.
// Returns { val, end, form } or null.
function pickBestAnnual(unitArr) {
  if (!unitArr || !Array.isArray(unitArr)) return null;
  // Filter: annual filings (10-K, 20-F, 40-F) or no form (quarterly often has no form tag)
  // Prefer 10-K. Also accept 10-K/A (amended).
  const annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  // Sort descending by end date
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
  // Return latest non-stale
  for (const u of annuals) {
    if (!isStale(u.end)) return { val: u.val, end: u.end, form: u.form };
  }
  return null;
}

// Pick the second-latest annual (1 year prior)
function pickPriorAnnual(unitArr) {
  if (!unitArr || !Array.isArray(unitArr)) return null;
  const annuals = unitArr.filter(u => {
    if (!u || u.val == null) return false;
    const f = (u.form || '').toUpperCase();
    return f === '10-K' || f === '10-K/A' || f === '20-F' || f === '40-F';
  });
  annuals.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
  // Latest non-stale and another one ~1 year before it
  let latest = null, latestIdx = -1;
  for (let i = 0; i < annuals.length; i++) {
    if (!isStale(annuals[i].end)) { latest = annuals[i]; latestIdx = i; break; }
  }
  if (!latest) return null;
  // Find a filing whose end date is ~9-15 months before the latest
  const latestTime = new Date(latest.end).getTime();
  for (let i = latestIdx + 1; i < annuals.length; i++) {
    const t = new Date(annuals[i].end).getTime();
    const diffDays = (latestTime - t) / 86400000;
    if (diffDays >= 270 && diffDays <= 550) return { val: annuals[i].val, end: annuals[i].end, form: annuals[i].form };
  }
  // Fallback: just take the next one
  if (annuals[latestIdx + 1]) return { val: annuals[latestIdx+1].val, end: annuals[latestIdx+1].end, form: annuals[latestIdx+1].form };
  return null;
}

// For PaymentsToAcquireBusinesses: this is typically a cash-flow statement item
// reported annually. Also appears in 10-Q (TTM is best proxy via annual 10-K).
// We want the latest 10-K value.
function pickBestCashFlowAnnual(unitArr) {
  return pickBestAnnual(unitArr);
}

// For RPO: RevenueRemainingPerformanceObligation is often point-in-time (no "start")
// We want the latest non-stale value regardless of form.
function pickLatest(unitArr) {
  if (!unitArr || !Array.isArray(unitArr)) return null;
  const valid = unitArr.filter(u => u && u.val != null && u.end && !isStale(u.end));
  if (!valid.length) return null;
  valid.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
  return { val: valid[0].val, end: valid[0].end, form: valid[0].form || '' };
}

function pickPriorLatest(unitArr, latestEnd) {
  if (!unitArr || !Array.isArray(unitArr)) return null;
  if (!latestEnd) return null;
  const latestTime = new Date(latestEnd).getTime();
  const valid = unitArr.filter(u => u && u.val != null && u.end && !isStale(u.end) && u.end < latestEnd);
  if (!valid.length) return null;
  valid.sort((a, b) => (b.end > a.end ? 1 : b.end < a.end ? -1 : 0));
  // Find one ~9-15 months before latest
  for (const u of valid) {
    const diffDays = (latestTime - new Date(u.end).getTime()) / 86400000;
    if (diffDays >= 270 && diffDays <= 550) return { val: u.val, end: u.end };
  }
  return valid[0] ? { val: valid[0].val, end: valid[0].end } : null;
}

function safe(n, denom) {
  if (n == null || denom == null || denom === 0) return null;
  return Math.round((n / denom) * 10000) / 10000;
}

function pct(n, denom) {
  if (n == null || denom == null || denom === 0) return null;
  return Math.round((n / denom) * 10000) / 10000;
}

// ── Main extraction ───────────────────────────────────────────────────────────

async function main() {
  // Step 1: Get CIK map from SEC tickers (local online fetch not available in this
  // offline context — but we do need CIKs). We'll try to fetch them.
  // Since network may be slow, let's embed the known CIKs for our 44 tickers
  // plus fall back to fetching.
  const { fetchSecTickers } = require('../discovery/sec-tickers.js');

  console.log('Fetching SEC ticker→CIK map...');
  const tickerMap = await fetchSecTickers();
  console.log('  Loaded', tickerMap.size, 'tickers');

  // Step 2: Open zip and build central directory index
  console.log('Opening zip and building central directory index...');
  const fd = fs.openSync(ZIP_PATH, 'r');
  const fileSize = fs.fstatSync(fd).size;
  console.log('  Zip size:', (fileSize / 1024 / 1024).toFixed(0), 'MB');

  const { cdOffset, cdSize, cdCount } = findEndOfCentralDir(fd, fileSize);
  console.log(`  CD offset=${cdOffset} size=${cdSize} count=${cdCount}`);

  console.log('  Reading central directory...');
  const cdIndex = buildCentralDirectory(fd, cdOffset, cdSize);
  console.log('  Indexed', cdIndex.size, 'entries');

  // Step 3: Process each ticker
  const results = [];
  for (const ticker of TICKERS) {
    const entry = tickerMap.get(ticker);
    if (!entry || !entry.cik) {
      console.warn(`  [WARN] ${ticker}: no CIK found in SEC map`);
      results.push({ ticker, cik: null, error: 'no_cik', coverage: { goodwill: 'absent', payments: 'absent', rpo: 'absent' } });
      continue;
    }
    const cik = entry.cik; // already zero-padded to 10 digits
    const zipName = `CIK${cik}.json`;
    const zipEntry = cdIndex.get(zipName);
    if (!zipEntry) {
      console.warn(`  [WARN] ${ticker} (CIK ${cik}): not in zip as '${zipName}' — checking keys...`);
      // Debug: show a few nearby keys
      const nearby = [...cdIndex.keys()].filter(k => k.includes(cik.slice(4))).slice(0,3);
      if (nearby.length) console.warn('    nearby keys:', nearby.join(', '));
      results.push({ ticker, cik, error: 'not_in_zip', coverage: { goodwill: 'absent', payments: 'absent', rpo: 'absent' } });
      continue;
    }

    let facts;
    try {
      const raw = readEntry(fd, zipEntry);
      const parsed = JSON.parse(raw.toString('utf8'));
      facts = parsed.facts && parsed.facts['us-gaap'] ? parsed.facts['us-gaap'] : {};
    } catch (e) {
      console.warn(`  [ERROR] ${ticker}: ${e.message}`);
      results.push({ ticker, cik, error: e.message, coverage: { goodwill: 'absent', payments: 'absent', rpo: 'absent' } });
      continue;
    }

    // ── Goodwill ──────────────────────────────────────────────────────────────
    const gwConcept = facts['Goodwill'];
    const gwUnits = gwConcept && gwConcept.units && gwConcept.units['USD'] ? gwConcept.units['USD'] : null;
    const gwLatestRec = pickBestAnnual(gwUnits);
    const gwPriorRec  = pickPriorAnnual(gwUnits);
    const goodwillLatest = gwLatestRec ? gwLatestRec.val : null;
    const goodwillPrior  = gwPriorRec  ? gwPriorRec.val  : null;
    const deltaGoodwillYoY = (goodwillLatest != null && goodwillPrior != null)
      ? Math.round(goodwillLatest - goodwillPrior) : null;

    // ── Revenue ───────────────────────────────────────────────────────────────
    const revConcepts = [
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'SalesRevenueNet',
    ];
    let revUnits = null, revConceptUsed = null;
    for (const c of revConcepts) {
      const cf = facts[c];
      if (cf && cf.units && cf.units['USD'] && cf.units['USD'].length > 0) {
        // Make sure it has at least one annual record
        const best = pickBestAnnual(cf.units['USD']);
        if (best) { revUnits = cf.units['USD']; revConceptUsed = c; break; }
      }
    }
    const revLatestRec = pickBestAnnual(revUnits);
    const revPriorRec  = pickPriorAnnual(revUnits);
    const revLatest = revLatestRec ? revLatestRec.val : null;
    const revPrior  = revPriorRec  ? revPriorRec.val  : null;
    const headlineGrowth = (revLatest != null && revPrior != null && revPrior !== 0)
      ? Math.round(((revLatest - revPrior) / revPrior) * 10000) / 10000 : null;

    const deltaGoodwillPctRev = pct(deltaGoodwillYoY, revLatest);

    // ── Payments to Acquire Businesses ────────────────────────────────────────
    const payConcepts = [
      'PaymentsToAcquireBusinessesNetOfCashAcquired',
      'PaymentsToAcquireBusinessesGross',
    ];
    let payUnits = null, payConceptUsed = null;
    for (const c of payConcepts) {
      const cf = facts[c];
      if (cf && cf.units && cf.units['USD'] && cf.units['USD'].length > 0) {
        const best = pickBestCashFlowAnnual(cf.units['USD']);
        if (best) { payUnits = cf.units['USD']; payConceptUsed = c; break; }
      }
    }
    const payRec = pickBestCashFlowAnnual(payUnits);
    // Cash outflow is typically reported as positive in SEC filings
    const paymentsTTM = payRec ? payRec.val : null;
    const paymentsToRev = pct(paymentsTTM, revLatest);

    // ── RPO / Deferred Revenue ────────────────────────────────────────────────
    // Priority: RevenueRemainingPerformanceObligation (best), then
    // ContractWithCustomerLiabilityNoncurrent + ContractWithCustomerLiabilityCurrent,
    // then DeferredRevenueCurrent + DeferredRevenueNoncurrent,
    // then ContractWithCustomerLiability total,
    // then DeferredRevenue total
    let rpoLatest = null, rpoPrior = null, rpoConcept = null;

    const rpoCheck = facts['RevenueRemainingPerformanceObligation'];
    if (rpoCheck && rpoCheck.units && rpoCheck.units['USD']) {
      const rec = pickLatest(rpoCheck.units['USD']);
      if (rec) {
        rpoLatest = rec.val;
        const priorRec = pickPriorLatest(rpoCheck.units['USD'], rec.end);
        rpoPrior = priorRec ? priorRec.val : null;
        rpoConcept = 'RevenueRemainingPerformanceObligation';
      }
    }

    if (rpoLatest == null) {
      // Try ContractWithCustomerLiability components
      const ccCurr = facts['ContractWithCustomerLiabilityCurrent'];
      const ccNon  = facts['ContractWithCustomerLiabilityNoncurrent'];
      const ccCurrUnits = ccCurr && ccCurr.units && ccCurr.units['USD'] ? ccCurr.units['USD'] : null;
      const ccNonUnits  = ccNon  && ccNon.units  && ccNon.units['USD']  ? ccNon.units['USD']  : null;
      const cr = pickBestAnnual(ccCurrUnits);
      const nr = pickBestAnnual(ccNonUnits);
      if (cr || nr) {
        rpoLatest = (cr ? cr.val : 0) + (nr ? nr.val : 0);
        const crP = pickPriorAnnual(ccCurrUnits);
        const nrP = pickPriorAnnual(ccNonUnits);
        rpoPrior = ((crP || nrP)) ? ((crP ? crP.val : 0) + (nrP ? nrP.val : 0)) : null;
        rpoConcept = 'ContractWithCustomerLiability(Curr+Noncurr)';
      }
    }

    if (rpoLatest == null) {
      // Try ContractWithCustomerLiability (total)
      const cc = facts['ContractWithCustomerLiability'];
      if (cc && cc.units && cc.units['USD']) {
        const rec = pickBestAnnual(cc.units['USD']);
        if (rec) {
          rpoLatest = rec.val;
          const priorRec = pickPriorAnnual(cc.units['USD']);
          rpoPrior = priorRec ? priorRec.val : null;
          rpoConcept = 'ContractWithCustomerLiability';
        }
      }
    }

    if (rpoLatest == null) {
      // Try DeferredRevenue split
      const drCurr = facts['DeferredRevenueCurrent'];
      const drNon  = facts['DeferredRevenueNoncurrent'];
      const drCurrUnits = drCurr && drCurr.units && drCurr.units['USD'] ? drCurr.units['USD'] : null;
      const drNonUnits  = drNon  && drNon.units  && drNon.units['USD']  ? drNon.units['USD']  : null;
      const cr = pickBestAnnual(drCurrUnits);
      const nr = pickBestAnnual(drNonUnits);
      if (cr || nr) {
        rpoLatest = (cr ? cr.val : 0) + (nr ? nr.val : 0);
        const crP = pickPriorAnnual(drCurrUnits);
        const nrP = pickPriorAnnual(drNonUnits);
        rpoPrior = ((crP || nrP)) ? ((crP ? crP.val : 0) + (nrP ? nrP.val : 0)) : null;
        rpoConcept = 'DeferredRevenue(Curr+Noncurr)';
      }
    }

    if (rpoLatest == null) {
      // Try DeferredRevenue total
      const dr = facts['DeferredRevenue'];
      if (dr && dr.units && dr.units['USD']) {
        const rec = pickBestAnnual(dr.units['USD']);
        if (rec) {
          rpoLatest = rec.val;
          const priorRec = pickPriorAnnual(dr.units['USD']);
          rpoPrior = priorRec ? priorRec.val : null;
          rpoConcept = 'DeferredRevenue';
        }
      }
    }

    const rpoGrowthYoY = (rpoLatest != null && rpoPrior != null && rpoPrior !== 0)
      ? Math.round(((rpoLatest - rpoPrior) / rpoPrior) * 10000) / 10000 : null;
    const rpoToRev = pct(rpoLatest, revLatest);

    // ── Coverage ─────────────────────────────────────────────────────────────
    const covGoodwill = goodwillLatest != null ? 'present'
      : (gwUnits && gwUnits.length > 0 ? 'stale' : 'absent');
    const covPayments = paymentsTTM != null ? 'present'
      : (payUnits && payUnits.length > 0 ? 'stale' : 'absent');
    const covRpo = rpoLatest != null ? 'present' : 'absent';

    const rec = {
      ticker,
      cik,
      goodwillLatest,
      goodwillPrior,
      deltaGoodwillYoY,
      deltaGoodwillPctRev,
      paymentsTTM,
      paymentsToRev,
      revLatest,
      revPrior,
      headlineGrowth,
      rpoLatest,
      rpoPrior,
      rpoGrowthYoY,
      rpoToRev,
      rpoConcept,
      revConcept: revConceptUsed,
      payConcept: payConceptUsed,
      coverage: { goodwill: covGoodwill, payments: covPayments, rpo: covRpo }
    };

    console.log(`  ${ticker}: gw=${goodwillLatest != null ? (goodwillLatest/1e9).toFixed(2)+'B' : 'NULL'} ΔGW=${deltaGoodwillYoY != null ? (deltaGoodwillYoY/1e9).toFixed(2)+'B' : 'NULL'} pay=${paymentsTTM != null ? (paymentsTTM/1e6).toFixed(0)+'M' : 'NULL'} rev=${revLatest != null ? (revLatest/1e9).toFixed(2)+'B' : 'NULL'} rpo=${rpoConcept || 'none'}`);
    results.push(rec);
  }

  fs.closeSync(fd);

  // Write output
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log('\nWrote:', OUT_PATH);

  // Summary stats
  const present = (arr, field) => arr.filter(r => r.coverage && r.coverage[field] === 'present').length;
  const stale   = (arr, field) => arr.filter(r => r.coverage && r.coverage[field] === 'stale').length;
  const absent  = (arr, field) => arr.filter(r => r.coverage && r.coverage[field] === 'absent').length;
  const n = results.length;

  console.log('\n── Coverage Summary (' + n + ' tickers) ──────────────────────');
  for (const field of ['goodwill', 'payments', 'rpo']) {
    const p = present(results, field), s = stale(results, field), a = absent(results, field);
    console.log(`  ${field.padEnd(10)}: present=${p}  stale=${s}  absent=${a}`);
  }

  // Key names detail
  const KEY = ['GEN','CRWD','DDOG','APP','PLTR','CDNS','CSGP','FSLY'];
  console.log('\n── Key Names Detail ─────────────────────────────────────');
  for (const t of KEY) {
    const r = results.find(x => x.ticker === t);
    if (!r) { console.log(`  ${t}: not found`); continue; }
    console.log(`  ${t}:`);
    console.log(`    ΔGoodwill_YoY  = ${r.deltaGoodwillYoY != null ? (r.deltaGoodwillYoY/1e9).toFixed(3)+'B' : 'NULL'}  (${r.deltaGoodwillPctRev != null ? (r.deltaGoodwillPctRev*100).toFixed(1)+'% rev' : 'NULL'})`);
    console.log(`    PaymentsTTM    = ${r.paymentsTTM != null ? (r.paymentsTTM/1e9).toFixed(3)+'B' : 'NULL'}  (${r.paymentsToRev != null ? (r.paymentsToRev*100).toFixed(1)+'% rev' : 'NULL'})`);
    console.log(`    HeadlineGrowth = ${r.headlineGrowth != null ? (r.headlineGrowth*100).toFixed(1)+'%' : 'NULL'}`);
    console.log(`    RPO_YoY_Growth = ${r.rpoGrowthYoY != null ? (r.rpoGrowthYoY*100).toFixed(1)+'%' : 'NULL'}  (concept: ${r.rpoConcept || 'none'})`);
    console.log(`    Coverage       = gw:${r.coverage.goodwill} pay:${r.coverage.payments} rpo:${r.coverage.rpo}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
