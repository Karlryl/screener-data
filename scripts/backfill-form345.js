#!/usr/bin/env node
/**
 * Workstream A1: SEC Form 3/4/5 quarterly BACKFILL.
 * =================================================
 * The daily puller (pull-insider-form4-daily.js) only sees ~180 days of
 * filings and only the days it has actually run. To bootstrap a deep history
 * — needed for the routine-vs-opportunistic insider feature, which scores a
 * reporting owner's CURRENT buy against THAT owner's own monthly trading
 * cadence — we backfill from SEC's quarterly "Insider Transactions Data
 * Sets". Each quarter is a single zip of pipe... actually TAB-separated
 * tables covering every Form 3/4/5 filed that quarter:
 *
 *   https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/{YYYY}q{N}_form345.zip
 *
 * Tables we join on ACCESSION_NUMBER:
 *   SUBMISSION.tsv     ACCESSION_NUMBER, FILING_DATE, PERIOD_OF_REPORT,
 *                      ISSUERCIK, ISSUERTRADINGSYMBOL, AFF10B5ONE
 *   NONDERIV_TRANS.tsv ACCESSION_NUMBER, TRANS_DATE, TRANS_CODE, TRANS_SHARES,
 *                      TRANS_PRICEPERSHARE, TRANS_ACQUIRED_DISP_CD,
 *                      SHRS_OWND_FOLWNG_TRANS
 *   REPORTINGOWNER.tsv ACCESSION_NUMBER, RPTOWNERCIK, RPTOWNERNAME,
 *                      RPTOWNER_RELATIONSHIP, RPTOWNER_TITLE
 *
 * Filter ISSUERTRADINGSYMBOL ∈ watchlist, merge into a SEPARATE history cache
 * external-data/sec-form4-history.json (same byTicker/transactions shape as
 * the daily cache, PLUS rptOwnerCik so the routine-detector can group a
 * person's transactions across filings). Atomic writes, resumable per
 * quarter.
 *
 * Zip handling: Node has no built-in zip reader. We shell out to `unzip`
 * (preferred) into external-data/tmp/. If `unzip` is unavailable we fail
 * GRACEFULLY with a clear message — backfill is a bootstrap step, not part
 * of the daily pipeline, so a missing tool degrades to "no history" rather
 * than crashing.
 *
 * Env knobs:
 *   QUARTERS=8       number of most-recent completed quarters (default 8)
 *   SAMPLE_LIMIT=1   only process the single most-recent quarter (smoke)
 *
 * Run:
 *   node scripts/backfill-form345.js
 *   SAMPLE_LIMIT=1 node scripts/backfill-form345.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const { writeFileAtomic } = require('../lib/atomic-write.js');

// ─── Config ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const EXTERNAL_DIR = path.join(ROOT, 'external-data');
const TICKER_CIK_MAP_PATH = path.join(EXTERNAL_DIR, 'sec-ticker-cik-map.json');
const TMP_DIR = path.join(EXTERNAL_DIR, 'tmp');
const HISTORY_CACHE_PATH = path.join(EXTERNAL_DIR, 'sec-form4-history.json');

const USER_AGENT = 'Karl Viehrig screener-data karl_viehrig@web.de';
const RATE_DELAY_MS = 125;
const ZIP_URL = (y, q) =>
  `https://www.sec.gov/files/structureddata/data/insider-transactions-data-sets/${y}q${q}_form345.zip`;

const QUARTERS = process.env.QUARTERS ? Math.max(1, parseInt(process.env.QUARTERS, 10)) : 8;
const SAMPLE_LIMIT = process.env.SAMPLE_LIMIT
  ? Math.max(1, parseInt(process.env.SAMPLE_LIMIT, 10))
  : null;

// ─── Tiny utils ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function hasUnzip() {
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}

// Download a binary file to disk (zips are large — stream to file rather
// than buffering, and follow redirects).
function downloadTo(url, destPath, _depth) {
  const depth = _depth | 0;
  if (depth > 5) return Promise.reject(new Error('too many redirects (>5) for ' + url));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        const next = res.headers.location;
        if (!next) return reject(new Error('redirect w/o Location: ' + url));
        return downloadTo(next, destPath, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) { res.resume(); return resolve({ notFound: true }); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      // audit/fix: stream to a .part temp + rename on finish so a killed/aborted download
      // can't leave a truncated file at destPath that a later run treats as a complete cache.
      const tmpPath = destPath + '.part';
      const out = fs.createWriteStream(tmpPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        try { fs.renameSync(tmpPath, destPath); resolve({ ok: true }); }
        catch (e) { try { fs.unlinkSync(tmpPath); } catch (_) {} reject(e); }
      }));
      out.on('error', (e) => { try { fs.unlinkSync(tmpPath); } catch (_) {} reject(e); });
      res.on('error', (e) => { try { fs.unlinkSync(tmpPath); } catch (_) {} reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout: ' + url)); });
  });
}

// ─── Quarter list ───────────────────────────────────────────────────────
// Most-recent COMPLETED quarter first, walking back QUARTERS quarters.
function recentCompletedQuarters(n) {
  const now = new Date();
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1; // current quarter (in progress)
  // step back to the last completed quarter
  q -= 1;
  if (q === 0) { q = 4; y -= 1; }
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ y, q });
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}

// ─── TSV parsing ────────────────────────────────────────────────────────
// SEC's data-set TSVs are tab-separated, header row first. We index columns
// by header name (the files are stable but defensive lookups cost nothing).
function parseTsv(filePath, wantCols) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split('\t');
  const idx = {};
  for (const c of wantCols) idx[c] = header.indexOf(c);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    const f = ln.split('\t');
    const row = {};
    for (const c of wantCols) row[c] = idx[c] >= 0 ? f[idx[c]] : undefined;
    rows.push(row);
  }
  return { header, idx, rows };
}

function findTsv(dir, base) {
  // Files may sit at the zip root or in a subdir; locate case-insensitively.
  const wanted = base.toLowerCase();
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name.toLowerCase() === wanted) return full;
    }
  }
  return null;
}

// ─── Merge / dedupe (history cache) ─────────────────────────────────────
// audit/fix BH-025: accession+date+code+shares alone collides two REAL
// distinct lots of the same accession/date/code/share-count but different
// price or owner (e.g. gestueckelte Fills). Widen the identity key with
// price, acquired/disposed and the reporting owner so legitimate multi-lot
// rows stop colliding.
function txnKey(t) {
  return [t.accessionNumber, t.transactionDate, t.transactionCode, t.transactionShares,
    t.transactionPricePerShare, t.acquiredDisposed, t.rptOwnerCik || t.reportingPersonName || ''
  ].join('|');
}
function normDate(s) {
  // SEC data-set dates are `DD-MON-YYYY` (e.g. 08-MAY-2026) — normalise to
  // ISO YYYY-MM-DD so they match the daily cache and dedupe cleanly.
  if (!s) return null;
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (m) {
    const MON = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
      JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
    const mm = MON[m[2].toUpperCase()];
    if (mm) return m[3] + '-' + mm + '-' + String(m[1]).padStart(2, '0');
  }
  // already ISO or unknown — pass through (Date.parse handles ISO)
  return s.trim();
}
function num(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

function writeHistory(byTicker) {
  writeFileAtomic(HISTORY_CACHE_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    source: 'sec-quarterly-form345-datasets',
    byTicker
  }, null, 2));
}

// ─── Process one quarter ────────────────────────────────────────────────
async function processQuarter(y, q, watchlistSymbols, byTicker) {
  const tag = y + 'q' + q;
  const zipPath = path.join(TMP_DIR, tag + '_form345.zip');
  const extractDir = path.join(TMP_DIR, tag);

  console.log('[' + tag + '] downloading ' + ZIP_URL(y, q));
  const dl = await downloadTo(ZIP_URL(y, q), zipPath);
  await sleep(RATE_DELAY_MS);
  if (dl.notFound) {
    console.log('[' + tag + '] dataset 404 (not yet published?) — skipping');
    return { skipped: true };
  }

  // Extract.
  ensureDir(extractDir);
  try {
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], { stdio: 'ignore' });
  } catch (e) {
    console.warn('[' + tag + '] unzip FAILED: ' + e.message + ' — skipping quarter');
    return { skipped: true, error: 'unzip' };
  }

  const subPath = findTsv(extractDir, 'SUBMISSION.tsv');
  const transPath = findTsv(extractDir, 'NONDERIV_TRANS.tsv');
  const ownPath = findTsv(extractDir, 'REPORTINGOWNER.tsv');
  if (!subPath || !transPath || !ownPath) {
    console.warn('[' + tag + '] expected TSVs not found (sub=' + !!subPath +
      ' trans=' + !!transPath + ' own=' + !!ownPath + ') — skipping');
    return { skipped: true, error: 'missing-tsv' };
  }

  // 1. SUBMISSION → keep only watchlist issuers; index by accession.
  const sub = parseTsv(subPath, ['ACCESSION_NUMBER', 'FILING_DATE', 'PERIOD_OF_REPORT',
    'ISSUERCIK', 'ISSUERTRADINGSYMBOL', 'AFF10B5ONE']);
  const accToSub = new Map();
  for (const r of sub.rows) {
    const sym = (r.ISSUERTRADINGSYMBOL || '').toUpperCase().trim();
    if (!sym || !watchlistSymbols.has(sym)) continue;
    accToSub.set(r.ACCESSION_NUMBER, {
      ticker: sym,
      issuerCik: r.ISSUERCIK,
      filingDate: normDate(r.FILING_DATE),
      isTenB5One: r.AFF10B5ONE === '1' || /^(1|true|y)$/i.test(r.AFF10B5ONE || '')
    });
  }
  console.log('[' + tag + '] submissions=' + sub.rows.length +
    ' watchlist-issuer filings=' + accToSub.size);

  // 2. REPORTINGOWNER → ALL owners per accession (joint/group filings list
  //    several reporting persons under one accession).
  // audit/fix BH-022: "first owner wins" silently dropped every co-filer but
  // the first. The dataset still ties a transaction to the ACCESSION, not to
  // one owner, so we still can't attribute a row to ONE specific owner — we
  // keep the first owner as the legacy single-owner fields (back-compat) and
  // additionally attach the full owners[] list (filing-wide, txn-agnostic).
  const own = parseTsv(ownPath, ['ACCESSION_NUMBER', 'RPTOWNERCIK', 'RPTOWNERNAME',
    'RPTOWNER_RELATIONSHIP', 'RPTOWNER_TITLE']);
  const accToOwners = new Map();
  for (const r of own.rows) {
    if (!accToSub.has(r.ACCESSION_NUMBER)) continue;       // only watchlist filings
    const relRaw = (r.RPTOWNER_RELATIONSHIP || '').toLowerCase();
    const ownerRec = {
      rptOwnerCik: r.RPTOWNERCIK || null,
      reportingPersonName: r.RPTOWNERNAME || null,
      reportingPersonRelationship: {
        isDirector: /director/.test(relRaw),
        isOfficer: /officer/.test(relRaw),
        isTenPercentOwner: /10|ten\s*percent/.test(relRaw),
        officerTitle: r.RPTOWNER_TITLE || null
      }
    };
    if (!accToOwners.has(r.ACCESSION_NUMBER)) accToOwners.set(r.ACCESSION_NUMBER, []);
    accToOwners.get(r.ACCESSION_NUMBER).push(ownerRec);
  }

  // 3. NONDERIV_TRANS → join, filter to watchlist filings, merge.
  const trans = parseTsv(transPath, ['ACCESSION_NUMBER', 'TRANS_DATE', 'TRANS_CODE',
    'TRANS_SHARES', 'TRANS_PRICEPERSHARE', 'TRANS_ACQUIRED_DISP_CD', 'SHRS_OWND_FOLWNG_TRANS']);

  let added = 0, pBuys = 0, considered = 0;
  for (const r of trans.rows) {
    const subInfo = accToSub.get(r.ACCESSION_NUMBER);
    if (!subInfo) continue;
    considered++;
    const owners = accToOwners.get(r.ACCESSION_NUMBER) || [];
    const owner = owners[0] || {};
    const code = (r.TRANS_CODE || '').trim();
    const txn = {
      transactionDate: normDate(r.TRANS_DATE),
      transactionCode: code,
      acquiredDisposed: (r.TRANS_ACQUIRED_DISP_CD || '').trim() || null,
      transactionShares: num(r.TRANS_SHARES),
      transactionPricePerShare: num(r.TRANS_PRICEPERSHARE),
      sharesOwnedFollowingTransaction: num(r.SHRS_OWND_FOLWNG_TRANS),
      reportingPersonName: owner.reportingPersonName || null,
      reportingPersonRelationship: owner.reportingPersonRelationship || null,
      rptOwnerCik: owner.rptOwnerCik || null,
      owners: owners,
      accessionNumber: r.ACCESSION_NUMBER,
      filingDate: subInfo.filingDate,
      issuerTradingSymbol: subInfo.ticker,
      // audit/fix BH-023 (note, no code change): AFF10B5ONE is a SUBMISSION-
      // level column in this quarterly TSV dataset — there is no per-
      // transaction footnote/id column here (unlike the live XML path in
      // pull-insider-form4.js), so a per-txn split isn't derivable from this
      // data source. Stays filing-wide; that's the source's own granularity,
      // not an implementation gap.
      isTenB5One: subInfo.isTenB5One
    };
    if (code === 'P') pBuys++;

    const ticker = subInfo.ticker;
    let entry = byTicker[ticker];
    if (!entry) {
      entry = { ticker, cik: subInfo.issuerCik || null, name: '', transactions: [] };
      byTicker[ticker] = entry;
      entry._seen = new Set();
    }
    if (!entry._seen) {
      entry._seen = new Set(entry.transactions.map(txnKey));
    }
    const k = txnKey(txn);
    if (entry._seen.has(k)) continue;
    entry._seen.add(k);
    entry.transactions.push(txn);
    added++;
  }
  console.log('[' + tag + '] nonderiv-trans=' + trans.rows.length +
    ' watchlist-matched=' + considered + ' added=' + added + ' P-buys=' + pBuys);

  // Cleanup extracted files + zip to keep the repo tmp dir small.
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(zipPath, { force: true }); } catch (_) {}

  return { added, pBuys };
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  ensureDir(EXTERNAL_DIR);
  ensureDir(TMP_DIR);

  if (!hasUnzip()) {
    console.error('');
    console.error('BACKFILL REQUIRES `unzip` — it is not on PATH in this environment.');
    console.error('Install unzip (e.g. `apt-get install unzip`) and re-run. The daily');
    console.error('puller (pull-insider-form4-daily.js) does NOT need unzip and is');
    console.error('unaffected; backfill is a one-off bootstrap of deep history.');
    process.exit(2);
  }

  const watchlist = readJsonSafe(WATCHLIST_PATH);
  if (!watchlist || !Array.isArray(watchlist.stocks)) {
    console.error('watchlist.json missing or malformed (.stocks[] required) — aborting');
    process.exit(1);
  }
  const map = readJsonSafe(TICKER_CIK_MAP_PATH);
  const byTickerMap = (map && map.byTicker) || {};

  // Watchlist symbols that are US-listed (present in the SEC ticker→CIK map).
  // ISSUERTRADINGSYMBOL in the dataset is the issuer's ticker, so we filter
  // on the symbol directly.
  const watchlistSymbols = new Set();
  for (const s of watchlist.stocks) {
    const t = (s.ticker || s.yahoo_symbol || '').toUpperCase().trim();
    if (t && byTickerMap[t]) watchlistSymbols.add(t);
  }
  console.log('[maps] watchlist US symbols: ' + watchlistSymbols.size);

  let quarters = recentCompletedQuarters(QUARTERS);
  if (SAMPLE_LIMIT) {
    quarters = quarters.slice(0, SAMPLE_LIMIT);
    console.log('[sample] SAMPLE_LIMIT=' + SAMPLE_LIMIT + ' → only most-recent ' +
      quarters.length + ' quarter(s)');
  }
  console.log('[quarters] ' + quarters.map(x => x.y + 'q' + x.q).join(', '));

  const existing = readJsonSafe(HISTORY_CACHE_PATH) || {};
  const byTicker = (existing.byTicker && typeof existing.byTicker === 'object')
    ? existing.byTicker : {};

  let grandAdded = 0, grandPBuys = 0;
  for (const { y, q } of quarters) {
    try {
      const r = await processQuarter(y, q, watchlistSymbols, byTicker);
      if (r && r.added) { grandAdded += r.added; grandPBuys += r.pBuys; }
    } catch (e) {
      console.warn('[' + y + 'q' + q + '] ERROR: ' + e.message + ' — continuing');
    }
    // Resumable: strip the per-entry _seen helper before writing, then
    // re-attach is unnecessary (rebuilt on next load).
    for (const t of Object.keys(byTicker)) { delete byTicker[t]._seen; }
    writeHistory(byTicker);
  }

  for (const t of Object.keys(byTicker)) { delete byTicker[t]._seen; }
  writeHistory(byTicker);

  const cacheTickers = Object.keys(byTicker).length;
  console.log('');
  console.log('Done. quarters=' + quarters.length + ' txnsAdded=' + grandAdded +
    ' P-buys=' + grandPBuys);
  console.log('History cache: ' + HISTORY_CACHE_PATH + ' (' + cacheTickers + ' tickers)');
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  recentCompletedQuarters, parseTsv, normDate, txnKey,
  _internals: { hasUnzip, num, findTsv }
};
