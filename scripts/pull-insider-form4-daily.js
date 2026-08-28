#!/usr/bin/env node
/**
 * Workstream A1: SEC EDGAR Form-4 DAILY puller (index-driven, not per-CIK).
 * =========================================================================
 * The per-ticker puller (pull-insider-form4.js) walks the SEC submissions
 * API once PER CIK — O(watchlist) requests/day, far too slow to run daily
 * for a 24k-ticker universe. This script flips the access pattern: it reads
 * SEC's DAILY FORM INDEX (one fixed-width text file per trading day listing
 * EVERY filing of every form type), keeps only FormType `4`, and intersects
 * the issuer CIK against the watchlist. That makes the per-day cost a single
 * index fetch plus one fetch per WATCHLIST HIT — typically a few dozen, not
 * thousands. NEVER iterate per-CIK over the whole universe here.
 *
 *   Daily index URL:
 *     https://www.sec.gov/Archives/edgar/daily-index/{YYYY}/QTR{n}/form.{YYYYMMDD}.idx
 *   Each Form-4 row:
 *     4   {ISSUER COMPANY NAME}   {ISSUER CIK}   {YYYYMMDD}   edgar/data/{cik}/{ACCESSION}.txt
 *   The FileName is the FULL submission .txt (Form-4 XML inline) so
 *   parseForm4Xml works on it directly.
 *
 * Merges into external-data/sec-form4-cache.json (shape shared with
 * pull-insider-form4.js: { updatedAt, userAgent, lookbackDays,
 * lastIndexedDate, byTicker }). Transactions deduped by accession+date+
 * code+shares+price+acquiredDisposed+owner; anything older than 180 days is
 * dropped at merge time to keep the cache bounded. lastIndexedDate is the
 * resumability cursor (BH-020): targetDates() fills the gap from there to
 * yesterday instead of a fixed DAYS window, so a missed run doesn't
 * permanently drop filings.
 *
 * SEC rules respected: contact User-Agent, gzip Accept-Encoding (the index
 * is large), ≥125ms throttle (≤8 req/s), atomic writes (lib/atomic-write),
 * resumable (cache re-written after every date).
 *
 * Env knobs:
 *   DAYS=5            number of recent trading days to pull (default 5)
 *   DATE=YYYYMMDD     pull a single specific date (overrides DAYS)
 *   SAMPLE_LIMIT=N    cap number of filing .txt fetches (smoke testing)
 *
 * Run:
 *   node scripts/pull-insider-form4-daily.js              # last 5 trading days
 *   DAYS=10 node scripts/pull-insider-form4-daily.js
 *   DATE=20260529 SAMPLE_LIMIT=5 node scripts/pull-insider-form4-daily.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const { writeFileAtomic } = require('../lib/atomic-write.js');
// Reuse the (now-extended) Form-4 XML parser — the full submission .txt
// carries the ownership XML inline so parseForm4Xml works on it directly.
// ladeForm4Cache: fail-loud-Leser fuer DIESE Datei — beide Skripte schreiben denselben
// Cache, also gilt dieselbe Erstanlage-Regel (F-CGPT-029, s. Kommentar dort).
const { parseForm4Xml, ladeForm4Cache } = require('./pull-insider-form4.js');

// ─── Config ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const EXTERNAL_DIR = path.join(ROOT, 'external-data');
const TICKER_CIK_MAP_PATH = path.join(EXTERNAL_DIR, 'sec-ticker-cik-map.json');
const FORM4_CACHE_PATH = path.join(EXTERNAL_DIR, 'sec-form4-cache.json');

const USER_AGENT = require('../lib/sec-user-agent').secUserAgent();
const SEC_RATE_LIMIT = require('../lib/sec-rate-limit.js');
const { RATE_DELAY_MS, RATE_LIMIT_BACKOFF_MS } = SEC_RATE_LIMIT;
// audit/fix: 429 IP-block backoff. On HTTP 429/503 SEC wants the client to slow
// WAY down; the normal 125 ms cadence keeps tripping the 10/s/IP limit and risks
// a ~10-min IP block. Wait 30 s and retry WITHOUT counting it as an error.
const FORM4_LOOKBACK_DAYS = 180;    // drop txns older than this at merge time
// audit/fix BH-020: hard cap on how many trading days a single run will
// catch up when resuming after a gap (CI outage, missed runs). Bounds the
// number of daily-index fetches in one run; days beyond the cap stay
// unindexed and are logged loudly instead of silently, forever, dropped.
const MAX_CATCHUP_DAYS = 60;

const DAILY_INDEX_URL = (y, q, ymd) =>
  `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${ymd}.idx`;
const SUBMISSION_TXT_URL = (cik, accDotted) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accDotted}.txt`;

const DAYS = process.env.DAYS ? Math.max(1, parseInt(process.env.DAYS, 10)) : 5;
const SINGLE_DATE = process.env.DATE ? String(process.env.DATE).trim() : null;
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

// HTTP GET with gzip/deflate support (the daily index is large), redirect
// cap, and 404→{notFound} (mirrors pull-insider-form4.js's httpGet but adds
// Accept-Encoding so the index download stays small).
function httpGet(url, _depth) {
  const depth = _depth | 0;
  if (depth > 5) return Promise.reject(new Error('too many redirects (>5) for ' + url));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        const nextUrl = res.headers.location;
        if (!nextUrl) return reject(new Error('redirect w/o Location: ' + url));
        return httpGet(nextUrl, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return resolve({ notFound: true });
      // audit/fix: carry the status code on the error (429 IP-block / 403 silent exit-0).
      // Previously every non-200/404 collapsed into a status-less Error, so the
      // per-item loop could not detect a 429 to back off (kept hammering SEC at
      // normal cadence → ~10-min IP block) nor a systemic 403 outage.
      if (res.statusCode === 403) {
        const err = new Error('HTTP 403 (rate-limited or bad UA): ' + url);
        err.statusCode = 403;
        return reject(err);
      }
      if (res.statusCode !== 200) {
        const err = new Error('HTTP ' + res.statusCode + ' for ' + url);
        err.statusCode = res.statusCode;
        return reject(err);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
        } catch (e) { return reject(new Error('gunzip failed for ' + url + ': ' + e.message)); }
        resolve({ body: buf.toString('utf8') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout: ' + url)); });
  });
}

// ─── Date helpers ───────────────────────────────────────────────────────
function ymd(d) {
  return d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0');
}
function quarterOf(month1to12) { return Math.floor((month1to12 - 1) / 3) + 1; }
function parseYmd(s) {
  // YYYYMMDD → UTC Date
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10);
  const d = parseInt(s.slice(6, 8), 10);
  return new Date(Date.UTC(y, m - 1, d));
}
function isWeekend(d) { const wd = d.getUTCDay(); return wd === 0 || wd === 6; }
// audit/fix BH-020: string-compare is safe for zero-padded YYYYMMDD.
function maxYmd(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// ─── Cursor-Ehrlichkeit (F-CGPT-030, P0-Haertung 09.08.2026) ────────────
// Der Cursor rueckte vor, SOBALD der Index-Abruf zurueckkam — auch bei 404, auch bevor
// irgendetwas verarbeitet war. Live nachgestellt (echtes main(), Index 404 fuer den
// Werktag 05.08.): lastIndexedDate=20260805, Log "no daily index (holiday/weekend/
// not-yet-posted)", Exit 0. Der naechste Lauf startet HINTER dem Tag — die Form 4s
// dieses Tages sind dauerhaft weg, weil dieses Skript nur ab dem Cursor nachlaedt.
//
// targetDates() liefert ausschliesslich Werktage. Ein 404 heisst hier also entweder
//   (a) Boersenfeiertag  -> es wird NIE einen Index geben -> Cursor MUSS vorruecken,
//                           sonst steht er fuer immer und die Nachlade-Spanne waechst
//                           bis an MAX_CATCHUP_DAYS, oder
//   (b) noch nicht gepostet (SEC stellt ~22:00 ET ein) -> der Index KOMMT noch ->
//                           Cursor muss stehen bleiben.
// Unterschieden wird am Alter statt an einem Feiertagskalender: was nach INDEX_KARENZ_TAGEN
// nicht da ist, kommt nicht mehr. Kalender waere genauer, muesste aber gepflegt werden und
// faellt bei jeder ungeplanten Schliessung (Trauertag, Sturm) auf denselben Fehler zurueck.
// ponytail: Alters-Heuristik statt Feiertagskalender; Karenz notfalls hochsetzen.
const INDEX_KARENZ_TAGE = 3;
function indexNachreichbar(dateYmd, jetzt = Date.now(), karenzTage = INDEX_KARENZ_TAGE) {
  return (jetzt - parseYmd(dateYmd).getTime()) < karenzTage * 86400000;
}

// Darf der "bis hier ist alles indiziert"-Cursor auf `date` gesetzt werden?
// EINE Regel, zwei Aufrufer (404-Zweig und Ende der Tagesverarbeitung).
function cursorDarfVor({ contiguous, notFound, date, jetzt, tagesFehler = 0, tagVollstaendig = true }) {
  if (!contiguous) return false;                       // eine fruehere Luecke im Lauf blockt alles danach
  if (notFound) return !indexNachreichbar(date, jetzt); // nur der endgueltig fehlende Index zaehlt als erledigt
  return tagesFehler === 0 && tagVollstaendig;          // sonst: nur ein WIRKLICH abgearbeiteter Tag
}

// Build the list of target YYYYMMDD strings. The index is posted ~22:00 ET,
// so "today" is usually not yet available — start from yesterday and walk
// back N *trading* days (skipping weekends; SEC posts no index then).
//
// audit/fix BH-020: N used to be the fixed DAYS env knob (default 5) with no
// memory of what was actually indexed last run — a CI/SEC outage lasting
// longer than DAYS trading days let filings fall permanently out of the
// cache, unnoticed. If `lastIndexedDate` (persisted in the cache by main())
// is given, target from the day AFTER it through yesterday instead, capped
// at MAX_CATCHUP_DAYS with a loud warning for anything beyond the cap. With
// no cursor (first run / fresh cache) we fall back to the old fixed-DAYS
// behaviour.
function targetDates(lastIndexedDate) {
  if (SINGLE_DATE) {
    if (!/^\d{8}$/.test(SINGLE_DATE)) {
      throw new Error('DATE must be YYYYMMDD, got: ' + SINGLE_DATE);
    }
    return [SINGLE_DATE];
  }
  const yesterday = new Date();
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  let wanted = DAYS;
  if (lastIndexedDate && /^\d{8}$/.test(lastIndexedDate)) {
    const since = parseYmd(lastIndexedDate);
    let gapDays = 0;
    const probe = new Date(yesterday);
    let guard2 = 0;
    while (probe.getTime() > since.getTime() && guard2 < (MAX_CATCHUP_DAYS + 30) * 3) {
      guard2++;
      if (!isWeekend(probe)) gapDays++;
      probe.setUTCDate(probe.getUTCDate() - 1);
    }
    if (gapDays > MAX_CATCHUP_DAYS) {
      console.warn('[coverage-gap] last indexed date ' + lastIndexedDate + ' is ' +
        gapDays + ' trading day(s) behind — capping catch-up to ' + MAX_CATCHUP_DAYS +
        ' day(s); ' + (gapDays - MAX_CATCHUP_DAYS) + ' older day(s) will remain unindexed.');
      wanted = MAX_CATCHUP_DAYS;
    } else {
      wanted = gapDays; // may be 0 (already caught up, e.g. re-run same day)
    }
  }

  const out = [];
  const cursor = new Date(yesterday);
  let guard = 0;
  while (out.length < wanted && guard < wanted * 3 + 14) {
    guard++;
    if (!isWeekend(cursor)) out.push(ymd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

// ─── Watchlist + ticker↔CIK maps ────────────────────────────────────────
// Build, from the SEC ticker→CIK map intersected with the watchlist:
//   - watchlistCiks: Set of UNPADDED int CIKs that are on the watchlist
//   - cikToTicker:   unpadded-int CIK → watchlist ticker symbol
// The daily index lists issuer CIKs UNPADDED, so we strip leading zeros to
// compare against the 10-digit-padded map CIKs.
function buildMaps() {
  const watchlist = readJsonSafe(WATCHLIST_PATH);
  if (!watchlist || !Array.isArray(watchlist.stocks)) {
    throw new Error('watchlist.json missing or malformed (.stocks[] required)');
  }
  const map = readJsonSafe(TICKER_CIK_MAP_PATH);
  if (!map || !map.byTicker) {
    throw new Error('sec-ticker-cik-map.json missing or malformed (.byTicker required)');
  }
  const byTicker = map.byTicker;

  // Watchlist tickers that have a known SEC CIK (i.e. US-listed bare symbols).
  const watchlistTickers = new Set();
  for (const s of watchlist.stocks) {
    const t = (s.ticker || s.yahoo_symbol || '').toUpperCase().trim();
    if (t && byTicker[t]) watchlistTickers.add(t);
  }

  const watchlistCiks = new Set();
  const cikToTicker = new Map();
  for (const ticker of watchlistTickers) {
    const cikPadded = byTicker[ticker].cik;
    const cikInt = parseInt(cikPadded, 10);
    if (!Number.isFinite(cikInt)) continue;
    watchlistCiks.add(cikInt);
    // First ticker wins if two map to the same CIK (rare share-class case);
    // the daily index resolves the issuer, not the share class, so either
    // symbol is acceptable for keying.
    if (!cikToTicker.has(cikInt)) cikToTicker.set(cikInt, ticker);
  }
  return { watchlistCiks, cikToTicker, watchlistTickers, byTicker };
}

// ─── Daily-index parsing ────────────────────────────────────────────────
// Rows are fixed-width-ish but the company name contains spaces, so we
// anchor on the stable trailing fields: FileName (last token, matches
// edgar/data/...), DateFiled (8 digits before it), CIK (digits before that).
// FormType is the first token. Returns [{cik:int, dateFiled, fileName,
// accession}].
function parseDailyForm4Rows(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  // audit F-A-2026-06-21: prevents silent loss of Form 4/A amendments that the
  // quarterly backfill keeps (daily-vs-history cache divergence). Accept the
  // optional '/A' amendment suffix in both the fast-path prefilter and regex.
  // audit F-A-2026-06-22: keep the '/A' amendment optional but NON-capturing — a
  // capturing (\/A)? shifted m[1..4], making cik read the amendment group (NaN).
  // audit/fix BH-024 (2026-07-19): now capturing '/A' AGAIN, deliberately —
  // callers need to tell an amendment apart from an original to purge-and-
  // replace instead of additively merging (see isAmendment below) — every
  // following group index is bumped by one (m[2]=cik, m[3]=date, m[4]=
  // fileName, m[5]=accession).
  const re = /^(4(?:\/A)?)\s+.+?\s+(\d+)\s+(\d{8})\s+(edgar\/data\/\d+\/([0-9-]+)\.txt)\s*$/;
  for (const line of lines) {
    if (line.charAt(0) !== '4') continue;       // FormType column starts with '4' (covers '4' and '4/A')
    const m = re.exec(line);
    if (!m) continue;
    rows.push({
      cik: parseInt(m[2], 10),
      dateFiled: m[3],
      fileName: m[4],
      accession: m[5],                          // dotted, e.g. 0001105965-26-000001
      // audit/fix BH-024: needed to treat a 4/A as a correction (replace) of
      // the original filing's txns rather than an additive new filing — the
      // amendment carries its OWN accession, so accession-keyed dedup alone
      // never recognises it as the same underlying report.
      isAmendment: m[1] === '4/A'
    });
  }
  return rows;
}

// ─── Merge / dedupe ─────────────────────────────────────────────────────
// audit/fix BH-025: accession+date+code+shares alone collides two REAL
// distinct lots of the same accession/date/code/share-count but different
// price or owner (e.g. a stock split into 100@$10 + 100@$12 same day) — the
// second is silently dropped as a "duplicate". Widen the identity key with
// price, acquired/disposed and the reporting person so legitimate multi-lot
// rows stop colliding.
function txnKey(t) {
  return [t.accessionNumber, t.transactionDate, t.transactionCode, t.transactionShares,
    t.transactionPricePerShare, t.acquiredDisposed, t.reportingPersonName || ''].join('|');
}
function withinLookback(dateStr, lookbackDays) {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= lookbackDays * 86400000;
}

// audit/fix BH-024: a 4/A carries its own accession number, so plain
// accession-keyed dedup (txnKey) never recognises it as a correction of the
// original filing — original and amendment txns would just coexist. Drop
// the prior cached txns for the SAME reporting period before the amendment's
// fresh txns are merged in below.
// ponytail: scoped by ticker+periodOfReport, not per-owner — good enough for
// the overwhelming single-owner-per-filing case; a joint-filing amendment
// could in theory also purge an untouched co-filer's txns for that period.
// Upgrade to period+owner if that surfaces in practice.
function purgeAmendedPeriod(entry, periodOfReport) {
  if (!entry || !Array.isArray(entry.transactions) || !periodOfReport) return 0;
  const before = entry.transactions.length;
  entry.transactions = entry.transactions.filter(t => t.periodOfReport !== periodOfReport);
  return before - entry.transactions.length;
}

// Merge a batch of new txns into byTicker[ticker], dedupe by txnKey, and
// drop anything older than the 180d lookback. Returns count actually added.
function mergeTransactions(byTicker, ticker, cikPadded, name, newTxns) {
  let entry = byTicker[ticker];
  if (!entry || typeof entry !== 'object') {
    entry = { ticker, cik: cikPadded, name: name || '', fetchedAt: null, transactions: [] };
    byTicker[ticker] = entry;
  }
  if (!Array.isArray(entry.transactions)) entry.transactions = [];
  // Prune stale txns already in the cache so it stays bounded.
  entry.transactions = entry.transactions.filter(t =>
    withinLookback(t.transactionDate || t.filingDate, FORM4_LOOKBACK_DAYS));

  const seen = new Set(entry.transactions.map(txnKey));
  let added = 0;
  for (const t of newTxns) {
    if (!withinLookback(t.transactionDate || t.filingDate, FORM4_LOOKBACK_DAYS)) continue;
    const k = txnKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    entry.transactions.push(t);
    added++;
  }
  entry.cik = cikPadded;
  if (name && !entry.name) entry.name = name;
  entry.fetchedAt = new Date().toISOString();
  return added;
}

// audit/fix BH-026: pure predicate for the bottom-of-main total-failure gate
// — unit-testable without mocking the SEC network calls.
function _isTotalFailure(fetched, errors, parseErrors) {
  return fetched === 0 && (errors > 0 || parseErrors > 0);
}

// audit/fix BH-021: pick the cache merge key from the FILING's own
// issuerTradingSymbol (all txns in one filing share it — issuer-level
// field), falling back to the watchlist ticker only when the filing omits
// it. Pulled out as a pure function so the "first-wins CIK collision"
// regression is unit-testable.
function resolveMergeTicker(parsedTxns, fallbackTicker) {
  const filedSymbol = (parsedTxns[0] && parsedTxns[0].issuerTradingSymbol)
    ? String(parsedTxns[0].issuerTradingSymbol).toUpperCase().trim() : '';
  return filedSymbol || fallbackTicker;
}

// KOMPAKT statt eingerueckt (28.08.2026): die Datei ist mit 58,3 MB die GROESSTE
// getrackte Datei im ganzen Repo und waechst zuletzt ~1 MB pro Tag — bei dem Tempo
// reisst sie im Oktober die 100-MB-Grenze von GitHub. `JSON.stringify(x, null, 2)`
// kostete allein an Einrueckung 21,5 MB: 58.269.916 -> 36.739.725 Bytes (-36,9 %),
// gemessen am echten Stand von origin/main, Round-Trip byte-identisch. Kein Datensatz
// faellt weg, keine Aufbewahrungsfrist aendert sich — das 180-Tage-Fenster (siehe
// FORM4_LOOKBACK_DAYS, mergeTransactions) bleibt unangetastet. Dieselbe Bauform wie
// external-data/sec-annual-bulk.jsonl und die NDJSON-Archive aus archive-old-snapshots.js:
// Massendaten werden hier kompakt geschrieben, nicht menschenlesbar eingerueckt.
// KEIN Ersatz fuer die eigentliche Frage (gehoert die Datei ueberhaupt nach git?) —
// das ist eine Karl-Entscheidung, siehe agent-reports/2026-08-28-karl-entscheidungen.md.
function writeCache(byTicker, lastIndexedDate) {
  writeFileAtomic(FORM4_CACHE_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    userAgentSource: 'process.env.SEC_CONTACT',
    lookbackDays: FORM4_LOOKBACK_DAYS,
    // audit/fix BH-020: persisted so the NEXT run's targetDates() knows where
    // it left off instead of always looking back a fixed DAYS window.
    lastIndexedDate: lastIndexedDate || null,
    byTicker
  }));
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  ensureDir(EXTERNAL_DIR);

  const { watchlistCiks, cikToTicker, watchlistTickers, byTicker: tickerCikMap } = buildMaps();
  console.log('[maps] watchlist US tickers (CIK known): ' + watchlistTickers.size +
    ' → ' + watchlistCiks.size + ' distinct issuer CIKs');

  // audit/fix BH-020: load the cache BEFORE computing target dates so the
  // last-successfully-indexed cursor (if any) can drive the date range.
  const existing = ladeForm4Cache();
  const byTicker = (existing.byTicker && typeof existing.byTicker === 'object')
    ? existing.byTicker : {};

  const dates = targetDates(existing.lastIndexedDate || null);
  console.log('[dates] targeting ' + dates.length + ' date(s): ' + dates.join(', '));

  let grandFetched = 0, grandHits = 0, grandAdded = 0, grandPBuys = 0, grandErrors = 0;
  let grandParseErrors = 0;
  let fetchBudgetLeft = SAMPLE_LIMIT == null ? Infinity : SAMPLE_LIMIT;

  // audit/fix BH-020: process oldest → newest so the "last indexed date"
  // cursor only ever advances contiguously — if an older date's index fetch
  // fails, the cursor stops there instead of jumping ahead to a later date
  // that happened to succeed, which would silently paper over the gap.
  let lastIndexedDate = existing.lastIndexedDate || null;
  let cursorContiguous = true;
  const processDates = dates.slice().reverse();

  for (const date of processDates) {
    if (fetchBudgetLeft <= 0) {
      console.log('[sample] SAMPLE_LIMIT reached — stopping before date ' + date);
      break;
    }
    const d = parseYmd(date);
    const q = quarterOf(d.getUTCMonth() + 1);
    const url = DAILY_INDEX_URL(d.getUTCFullYear(), q, date);

    let idxRes;
    try { idxRes = await httpGet(url); }
    catch (e) {
      // audit/fix: 429 IP-block backoff. On a rate-limit (429) or 503, back off
      // 30 s and retry this date's index ONCE WITHOUT incrementing grandErrors —
      // skipping the date and racing to the next one at normal cadence would keep
      // hammering SEC into a ~10-min IP block.
      if (e && (e.statusCode === 429 || e.statusCode === 503)) {
        console.warn('[' + date + '] index rate-limited (HTTP ' + e.statusCode +
          ') — backing off ' + (RATE_LIMIT_BACKOFF_MS / 1000) + 's and retrying');
        await sleep(RATE_LIMIT_BACKOFF_MS);
        try { idxRes = await httpGet(url); }
        catch (e2) {
          console.warn('[' + date + '] index fetch ERROR (post-backoff): ' + e2.message + ' — skipping date');
          grandErrors++;
          cursorContiguous = false; // audit/fix BH-020: stop advancing lastIndexedDate past a gap
          await sleep(RATE_DELAY_MS);
          continue;
        }
      } else {
        console.warn('[' + date + '] index fetch ERROR: ' + e.message + ' — skipping date');
        grandErrors++;
        cursorContiguous = false; // audit/fix BH-020: stop advancing lastIndexedDate past a gap
        await sleep(RATE_DELAY_MS);
        continue;
      }
    }
    await sleep(RATE_DELAY_MS);
    if (idxRes.notFound) {
      // F-CGPT-030: nur ein Index, der nicht mehr kommt (Feiertag), gilt als erledigt.
      if (cursorDarfVor({ contiguous: cursorContiguous, notFound: true, date, jetzt: Date.now() })) {
        lastIndexedDate = date;
        // R609-3: als ::warning:: statt console.log. Dieser Zweig rueckt den Cursor ueber
        // einen Tag vor, von dem NIE ein Index kam — richtig fuer einen Boersenfeiertag,
        // aber genauso die Form, die ein dauerhaft geaenderter SEC-Index-Pfad annehmen
        // wuerde. Als Run-Annotation faellt eine Haeufung auf; im Log verschwand sie
        // zwischen hunderten Zeilen.
        console.warn('::warning::[' + date + '] kein Tagesindex und aelter als ' + INDEX_KARENZ_TAGE +
          ' Tage (Boersenfeiertag) — Cursor rueckt vor');
      } else {
        cursorContiguous = false;
        console.warn('::warning::[' + date + '] Tagesindex fehlt, ist aber juenger als ' +
          INDEX_KARENZ_TAGE + ' Tage — SEC hat ihn vermutlich noch nicht eingestellt. Cursor ' +
          'bleibt auf ' + (lastIndexedDate || 'null') + ', der naechste Lauf holt den Tag nach.');
      }
      continue;
    }

    const allRows = parseDailyForm4Rows(idxRes.body);
    // Intersect issuer CIK with the watchlist.
    const hits = allRows.filter(r => watchlistCiks.has(r.cik));
    console.log('[' + date + '] form-4 rows=' + allRows.length +
      ' watchlist hits=' + hits.length);

    let dayFetched = 0, dayAdded = 0, dayPBuys = 0, dayParseErrors = 0;
    // F-CGPT-030: der Tag gilt nur als indiziert, wenn er auch abgearbeitet wurde.
    let dayErrors = 0, dayVollstaendig = true;
    for (const hit of hits) {
      if (fetchBudgetLeft <= 0) {
        console.log('  [sample] SAMPLE_LIMIT reached mid-date — stopping');
        dayVollstaendig = false;   // abgebrochen -> der Tag ist NICHT durchindiziert
        break;
      }
      const ticker = cikToTicker.get(hit.cik);
      const cikPadded = (tickerCikMap[ticker] && tickerCikMap[ticker].cik) ||
        String(hit.cik).padStart(10, '0');
      const name = (tickerCikMap[ticker] && tickerCikMap[ticker].name) || '';

      const docUrl = SUBMISSION_TXT_URL(hit.cik, hit.accession);
      let docRes;
      try { docRes = await httpGet(docUrl); }
      catch (e) {
        // audit/fix: 429 IP-block backoff. On a rate-limit (429) or 503, back off
        // 30 s and retry this hit WITHOUT incrementing grandErrors and WITHOUT
        // consuming a fetch-budget slot — counting a transient throttle as an
        // error and continuing at normal cadence risks a ~10-min SEC IP block.
        if (e && (e.statusCode === 429 || e.statusCode === 503)) {
          console.warn('  [' + ticker + '] rate-limited (HTTP ' + e.statusCode +
            ') — backing off ' + (RATE_LIMIT_BACKOFF_MS / 1000) + 's and retrying');
          await sleep(RATE_LIMIT_BACKOFF_MS);
          try { docRes = await httpGet(docUrl); }
          catch (e2) {
            console.warn('  [' + ticker + '] fetch ERROR (post-backoff) ' + hit.accession + ': ' + e2.message);
            grandErrors++; dayErrors++;
            await sleep(RATE_DELAY_MS);
            continue;
          }
        } else {
          console.warn('  [' + ticker + '] fetch ERROR ' + hit.accession + ': ' + e.message);
          grandErrors++; dayErrors++;
          await sleep(RATE_DELAY_MS);
          continue;
        }
      }
      await sleep(RATE_DELAY_MS);
      fetchBudgetLeft--;
      if (docRes.notFound || !docRes.body) continue;

      let parsed;
      try { parsed = parseForm4Xml(docRes.body); }
      catch (e) {
        // audit/fix BH-026: count parse failures SEPARATELY from successful
        // fetches — previously dayFetched/grandFetched were incremented
        // before the parse attempt, so a run of all-200-but-unparsable
        // filings looked identical to a healthy 0-hits day in the
        // total-failure gate at the bottom of main().
        dayParseErrors++; grandParseErrors++;
        continue;
      }
      // Counted only once actually parsed — see BH-026 note above.
      dayFetched++; grandFetched++;

      // audit/fix BH-021: key the cache entry by the symbol the FILING
      // itself reports (issuer-level <issuerTradingSymbol>), not by the
      // first-wins watchlist ticker the CIK happened to resolve to — two
      // watchlist tickers can share one CIK (share classes / dual listings)
      // and first-wins silently folds the loser's filings under the
      // winner's symbol. Fall back to the watchlist ticker only when the
      // filing itself omits the symbol.
      const mergeTicker = resolveMergeTicker(parsed, ticker);

      const filingDate = hit.dateFiled.slice(0, 4) + '-' +
        hit.dateFiled.slice(4, 6) + '-' + hit.dateFiled.slice(6, 8);
      const newTxns = [];
      for (const t of parsed) {
        t.accessionNumber = hit.accession;
        t.filingDate = filingDate;
        // Prefer the symbol parsed from the filing; fall back to the
        // watchlist ticker the CIK resolved to.
        if (!t.issuerTradingSymbol) t.issuerTradingSymbol = mergeTicker;
        newTxns.push(t);
        if (t.transactionCode === 'P') { dayPBuys++; grandPBuys++; }
      }
      // audit/fix BH-024: a 4/A replaces (not adds to) the original filing's
      // txns for the same reporting period — purge before merging.
      if (hit.isAmendment) {
        const period = parsed[0] && parsed[0].periodOfReport;
        purgeAmendedPeriod(byTicker[mergeTicker], period);
      }
      const added = mergeTransactions(byTicker, mergeTicker, cikPadded, name, newTxns);
      dayAdded += added; grandAdded += added;
    }

    grandHits += hits.length;
    console.log('[' + date + '] done: fetched=' + dayFetched + ' txnsAdded=' +
      dayAdded + ' P-buys=' + dayPBuys + ' parseErrors=' + dayParseErrors);

    // F-CGPT-030: Cursor NACH der Verarbeitung, und nur wenn sie durchlief. Bleibt er stehen,
    // sperrt cursorContiguous auch alle spaeteren Tage dieses Laufs — der Cursor ist eine
    // "bis hier LUECKENLOS"-Marke, kein Fortschrittsbalken. (dayParseErrors zaehlt bewusst
    // NICHT mit: eine dauerhaft unparsbare Einreichung wuerde den Cursor sonst fuer immer
    // festnageln; sie faellt ueber grandParseErrors ins Total-Failure-Gate.)
    if (cursorDarfVor({ contiguous: cursorContiguous, notFound: false, date, jetzt: Date.now(),
      tagesFehler: dayErrors, tagVollstaendig: dayVollstaendig })) {
      lastIndexedDate = date;
    } else {
      cursorContiguous = false;
      console.warn('::warning::[' + date + '] nicht vollstaendig indiziert (Abruffehler=' + dayErrors +
        (dayVollstaendig ? '' : ', vorzeitig abgebrochen') + ') — Cursor bleibt auf ' +
        (lastIndexedDate || 'null') + ', der naechste Lauf holt den Tag nach.');
    }

    // audit/fix BH-020: never move the persisted cursor BACKWARD — guards
    // the SINGLE_DATE ad-hoc-backfill knob (an arbitrary, possibly older,
    // single date) from regressing a cursor that's already further ahead.
    const persistedCursor = maxYmd(existing.lastIndexedDate, lastIndexedDate);
    // Resumable: atomically re-write the full cache after every date.
    writeCache(byTicker, persistedCursor);
  }

  // Final write (covers the SINGLE_DATE / early-break paths).
  writeCache(byTicker, maxYmd(existing.lastIndexedDate, lastIndexedDate));

  const cacheTickers = Object.keys(byTicker).length;
  console.log('');
  console.log('Done. dates=' + dates.length + ' hits=' + grandHits +
    ' fetched=' + grandFetched + ' txnsAdded=' + grandAdded +
    ' P-buys=' + grandPBuys + ' errors=' + grandErrors +
    ' parseErrors=' + grandParseErrors);
  console.log('Cache: ' + FORM4_CACHE_PATH + ' (' + cacheTickers + ' tickers)');

  // audit/fix: 403 silent exit-0. If NOTHING was fetched but errors occurred
  // (grandFetched === 0 && grandErrors > 0) the run was a total failure —
  // typically a systemic 403/UA/IP-block outage rather than a quiet holiday with
  // no filings. Exit non-zero so CI surfaces it instead of a green empty run.
  // (A genuine no-filings day fetches 0 with 0 errors and correctly stays exit 0.)
  // audit/fix BH-026: also trip on grandParseErrors — an all-200-but-
  // unparsable run must not look like a healthy empty day either.
  if (_isTotalFailure(grandFetched, grandErrors, grandParseErrors)) {
    console.error('TOTAL FAILURE: 0 filings fetched with ' + grandErrors +
      ' error(s) / ' + grandParseErrors +
      ' parse-error(s) — likely a systemic SEC outage / 403 / IP block. Exiting 1.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  // R609-4: `main` exportiert als Test-Seam (Bauform wie build-krannual.js). Der
  // require.main-Guard darueber sorgt dafuer, dass ein require() weiterhin keinen
  // Lauf ausloest.
  main,
  parseDailyForm4Rows, targetDates, buildMaps, mergeTransactions,
  _internals: {
    httpGet, quarterOf, ymd, parseYmd, withinLookback, txnKey,
    purgeAmendedPeriod, maxYmd, resolveMergeTicker, _isTotalFailure,
    cursorDarfVor, indexNachreichbar, INDEX_KARENZ_TAGE
  },
  _secRateLimit: SEC_RATE_LIMIT
};
