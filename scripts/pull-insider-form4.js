#!/usr/bin/env node
/**
 * Tag 210e: SEC EDGAR Form 4 Insider-Transaction Puller
 * =====================================================
 * Reads watchlist.json, fetches Form 4 filings for each US-listed ticker
 * from SEC EDGAR over the last 180 days, parses out the insider
 * transactions and writes them to a single committed cache file
 * (external-data/sec-form4-cache.json).
 *
 * Why this exists (per Tag 208 data-source research, audit-reports/
 * 2026-05-16-tag208-data-sources.md): SEC EDGAR Form 4 is free, keyless,
 * authoritative, and adds insider-timing signal that Yahoo Finance's
 * `insiderTransactions` module doesn't cover well (especially outside
 * the mega-caps). methods/insider-buy-cluster.js and
 * methods/insider-net-buying.js currently read from
 * stock.insiderActivity / stock.insider (populated by pull-yahoo.js).
 * Once this cache stabilises we'll have a parallel, independent feed —
 * wiring those methods to also read from sec-form4-cache.json is
 * FUTURE WORK and intentionally out of scope for this commit.
 *
 * Two cache files:
 *   external-data/sec-ticker-cik-map.json   — ticker→CIK map (weekly refresh)
 *   external-data/sec-form4-cache.json      — per-ticker Form 4 transactions
 *
 * Both written atomically (lib/atomic-write.js — Tag 189) so a SIGKILL
 * mid-write doesn't corrupt the on-disk JSON.
 *
 * SEC rules respected:
 *   - User-Agent header includes a contact (required by SEC ToU).
 *   - Throttle to ~8 req/sec (under the 10 req/sec/IP limit). Exceeding
 *     the limit gets the IP blocked for ~10 min.
 *
 * Idempotent / resumable:
 *   - Per-ticker freshness gate: if a ticker's cache entry is < 24 h old,
 *     skip its fetches entirely.
 *   - After each ticker is finished, the full cache file is re-written
 *     atomically — so a Ctrl-C halfway through still leaves a usable
 *     cache, and the next run picks up where it stopped.
 *
 * Run locally:
 *   & "C:\Program Files\nodejs\node.exe" scripts/pull-insider-form4.js
 *
 * Smoke test (first N US tickers only):
 *   $env:SAMPLE_LIMIT = '5'; & "C:\Program Files\nodejs\node.exe" scripts/pull-insider-form4.js
 *
 * NOT wired into daily-pull.yml on purpose. Manual trigger only until the
 * cache shape is validated against the consuming methods. Daily wiring +
 * methods/insider-*.js read-from-cache is a follow-up (Tag 21x).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

// Tag 189: atomic tmp+rename writes for both cache files.
const { writeFileAtomic } = require('../lib/atomic-write.js');
const { readJsonExistingOrThrow, FEHLT } = require('../lib/read-json.js');

// ─── Config ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const WATCHLIST_PATH = path.join(ROOT, 'watchlist.json');
const EXTERNAL_DIR = path.join(ROOT, 'external-data');
const TICKER_CIK_MAP_PATH = path.join(EXTERNAL_DIR, 'sec-ticker-cik-map.json');
const FORM4_CACHE_PATH = path.join(EXTERNAL_DIR, 'sec-form4-cache.json');

// SEC EDGAR endpoints. ticker→CIK map is a single static file; submissions
// index is per-CIK; the primary Form 4 doc lives in the filing's archive
// directory.
const SEC_TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS_URL = cik => `https://data.sec.gov/submissions/CIK${cik}.json`;
const SEC_ARCHIVE_URL = (cik, accNoDash, doc) =>
  `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/${doc}`;

// SEC requires a User-Agent that identifies the requester with a contact
// (https://www.sec.gov/os/accessing-edgar-data). Hardcoded per the task
// spec; if SEC ever complains they'll email this address before blocking.
// Tag 211j: real contact per SEC EDGAR Terms of Use — fake addresses can
// be silently rate-limited or rejected. Karl's screener-data, public repo.
const USER_AGENT = require('../lib/sec-user-agent').secUserAgent();
const SEC_RATE_LIMIT = require('../lib/sec-rate-limit.js');

// Throttle: 8 req/sec = 125 ms inter-call delay, comfortably under SEC's
// documented 10/sec/IP limit. Shared with the other SEC pullers.
const { RATE_DELAY_MS, RATE_LIMIT_BACKOFF_MS } = SEC_RATE_LIMIT;

// audit/fix: 429 IP-block backoff. On HTTP 429 (rate-limited) or 503 SEC wants
// the client to slow WAY down — a normal 125 ms cadence keeps tripping the
// 10/s/IP limit and risks a ~10-min IP block. Wait 30 s and retry the ticker
// WITHOUT counting it as an abort-budget error.
// Per-ticker cache freshness gate. Form 4s have a T+2 filing deadline so
// 24 h is plenty fresh for trading-day purposes.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Filing-history window. Anything older than this is dropped; the
// downstream methods score on 90 d and 180 d windows so 180 d is the
// natural upper bound.
const FORM4_LOOKBACK_DAYS = 180;

// Ticker→CIK map staleness. SEC re-publishes the file on every business
// day but content changes are rare (only when new IPOs list); a weekly
// refresh is more than sufficient.
const TICKER_MAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Smoke-test knob. SAMPLE_LIMIT=5 → only process the first 5 US-listed
// tickers in the watchlist. Used by tests and local validation runs.
const SAMPLE_LIMIT = process.env.SAMPLE_LIMIT
  ? Math.max(1, parseInt(process.env.SAMPLE_LIMIT, 10))
  : null;

// ─── Tiny utils ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

// F-CGPT-029 (P0-Haertung 09.08.2026): der Form-4-Cache wurde mit
// `readJsonSafe(FORM4_CACHE_PATH) || {}` geladen — eine vorhandene, aber unlesbare Datei
// war damit von "gibt es noch nicht" nicht zu unterscheiden. Live nachgestellt (echtes
// main(), Netz gestubbt, SAMPLE_LIMIT=1): korrupter Cache -> byTicker startet leer -> nach
// dem ersten Ticker wird der volle Cache neu geschrieben, jeder andere Name ist weg,
// Exit 0. Der Cache ist ~42 MB Insider-Historie; sie ist nicht nachziehbar, weil das
// Tagesskript nur ab dem Cursor nachlaedt.
//
// Erstanlage = Datei fehlt. Korrupt = vorhandener Bestand -> Wurf, nichts wird ueberschrieben.
// Beide Form-4-Skripte teilen sich diesen Leser (pull-insider-form4-daily.js importiert ihn),
// damit die Regel an EINER Stelle steht — sie schreiben dieselbe Datei.
function ladeForm4Cache(p = FORM4_CACHE_PATH) {
  const v = readJsonExistingOrThrow(p);
  return v === FEHLT ? {} : v;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Mirror the redirect-cap pattern from pull-sec-xbrl.js (F-SC-015) so a
// misconfigured SEC URL or infinite redirect chain can't blow the stack.
function httpGet(url, _depth) {
  const depth = _depth | 0;
  if (depth > 5) return Promise.reject(new Error('too many redirects (>5) for ' + url));
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' }
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
        const err = new Error('HTTP 403 (likely rate-limited or bad UA): ' + url);
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
      res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout: ' + url)); });
  });
}

// ─── Ticker→CIK mapping ─────────────────────────────────────────────────
// Loaded once at script start. Cached for a week.
async function loadTickerCikMap() {
  const existing = readJsonSafe(TICKER_CIK_MAP_PATH);
  if (existing && existing.fetchedAt &&
      (Date.now() - new Date(existing.fetchedAt).getTime()) < TICKER_MAP_TTL_MS &&
      existing.byTicker && Object.keys(existing.byTicker).length > 0) {
    console.log('  [map] using cached ticker→CIK (' +
      Object.keys(existing.byTicker).length + ' tickers, age ' +
      Math.round((Date.now() - new Date(existing.fetchedAt).getTime()) / 3600000) + 'h)');
    return existing.byTicker;
  }
  console.log('  [map] fetching ticker→CIK from SEC...');
  const res = await httpGet(SEC_TICKER_MAP_URL);
  if (res.notFound) throw new Error('SEC ticker map URL 404 (unexpected)');
  const parsed = JSON.parse(res.body);
  const byTicker = {};
  // The map is keyed by row-index, with each row being
  // { cik_str, ticker, title }. We normalise to UPPER and 10-digit CIK.
  for (const row of Object.values(parsed)) {
    const ticker = (row.ticker || '').toUpperCase().trim();
    if (!ticker) continue;
    const cik = String(row.cik_str || row.cik || '').padStart(10, '0');
    if (cik === '0000000000') continue;
    byTicker[ticker] = { cik, name: row.title || '' };
  }
  ensureDir(EXTERNAL_DIR);
  writeFileAtomic(TICKER_CIK_MAP_PATH, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source: SEC_TICKER_MAP_URL,
    count: Object.keys(byTicker).length,
    byTicker
  }, null, 2));
  console.log('  [map] cached ' + Object.keys(byTicker).length + ' ticker→CIK entries');
  return byTicker;
}

// ─── Form 4 doc parser ──────────────────────────────────────────────────
// SEC Form 4 primary doc is XML (XBRL-flavoured). We avoid pulling a full
// XML parser; the relevant fields are flat repeating <transactionDate>
// <transactionCoding><transactionCode> <transactionAmounts>
// <transactionShares><value>N</value></transactionShares> ... groups.
// Multiple <nonDerivativeTransaction> blocks per filing — we extract
// each one independently. Pattern-based, no per-issuer special cases.

function _extractAll(xml, tag) {
  // Returns every <tag>...</tag> inner-text occurrence (greedy across
  // nested children, terminated by the matching close tag). Tolerant of
  // namespace prefixes — we don't include any in the tag names we hunt
  // for because Form 4 XML uses unprefixed element names.
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function _extractFirst(xml, tag) {
  const all = _extractAll(xml, tag);
  return all.length ? all[0] : null;
}

function _innerValue(xml) {
  // Form 4 wraps scalars in <value>X</value> *inside* the parent tag, e.g.
  //   <transactionShares><value>100</value></transactionShares>
  // We pull the value out, or fall back to the raw text if there's no
  // wrapper.
  if (xml == null) return null;
  const v = _extractFirst(xml, 'value');
  return (v != null ? v : xml).trim();
}

// audit/fix BH-023: id -> footnote-text map, scanning every <footnotes>
// block (there's normally one, but we stay defensive per the earlier
// all-footnotes-blocks fix below). Real Form 4 XML wraps each footnote as
// <footnote id="F1">text</footnote>; ids are referenced per-transaction via
// <footnoteId id="F1"/> nested inside that transaction's own sub-elements
// (verified against a live SEC filing, 2025-12, HIMS CIK 1773751).
function _footnoteMap(xml) {
  const map = {};
  for (const fnBlock of _extractAll(xml, 'footnotes')) {
    const re = /<footnote\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/footnote>/g;
    let m;
    while ((m = re.exec(fnBlock)) !== null) map[m[1]] = m[2];
  }
  return map;
}

// audit/fix BH-023: every footnoteId referenced ANYWHERE inside one
// transaction block (transactionCoding, transactionAmounts/…PricePerShare,
// etc. can each carry their own <footnoteId id="X"/>).
function _txnFootnoteIds(block) {
  const ids = [];
  const re = /<footnoteId\b[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(block)) !== null) ids.push(m[1]);
  return ids;
}

function parseForm4Xml(xml) {
  const txns = [];

  // Tag A1: issuer-level fields parsed once and attached to every txn for
  // downstream convenience.
  //   issuerTradingSymbol — <issuer><issuerTradingSymbol>SYM</issuerTradingSymbol>
  const issuerBlock = _extractFirst(xml, 'issuer') || '';
  const issuerTradingSymbol =
    _innerValue(_extractFirst(issuerBlock, 'issuerTradingSymbol')) || null;
  // audit/fix BH-024: <periodOfReport> is filing-wide (not wrapped in
  // <value>), needed to correlate a 4/A amendment back to the original
  // filing it corrects (same ticker + same reporting period).
  const periodOfReport = _innerValue(_extractFirst(xml, 'periodOfReport')) || null;

  // audit/fix: scan ALL <footnotes> blocks, not just the first. _extractFirst
  // returned only all[0], so a 10b5-1 plan mention in a LATER footnotes block
  // was missed (false isTenB5One=false → mislabelled discretionary trade).
  const structuredAff10b5One = /<aff10b5One>\s*(1|true)\b/i.test(xml);
  const footnoteMap = _footnoteMap(xml);
  const anyFootnoteMentions10b51 =
    Object.values(footnoteMap).some(t => /10b5-?\s?1/i.test(t));

  // audit/fix BH-022: collect ALL <reportingOwner> blocks, not just the
  // first — joint/group filings (spouse, trust, co-officers) lose every
  // owner but the first otherwise. The source ties a transaction to the
  // ACCESSION, not to a specific owner, so we still can't attribute a row
  // to ONE owner; we attach the full owners[] list filing-wide (txn-agnostic)
  // alongside the legacy single-owner fields (= first owner, kept for
  // backward compatibility with existing consumers/fixtures).
  const owners = _extractAll(xml, 'reportingOwner').map(ownerBlock => {
    const rel = _extractFirst(ownerBlock, 'reportingOwnerRelationship') || '';
    return {
      name: _innerValue(_extractFirst(ownerBlock, 'rptOwnerName')) || null,
      relationship: {
        isDirector: /<isDirector>\s*(true|1)\s*<\/isDirector>/i.test(rel),
        isOfficer: /<isOfficer>\s*(true|1)\s*<\/isOfficer>/i.test(rel),
        isTenPercentOwner: /<isTenPercentOwner>\s*(true|1)\s*<\/isTenPercentOwner>/i.test(rel),
        isOther: /<isOther>\s*(true|1)\s*<\/isOther>/i.test(rel),
        officerTitle: _innerValue(_extractFirst(rel, 'officerTitle')) || null
      }
    };
  });
  const personName = owners.length ? owners[0].name : null;
  const relationship = owners.length ? owners[0].relationship : {
    isDirector: false, isOfficer: false, isTenPercentOwner: false,
    isOther: false, officerTitle: null
  };

  // All non-derivative transactions (= the ones the methods care about;
  // derivative options/RSUs are noisier and we drop them for v1).
  for (const block of _extractAll(xml, 'nonDerivativeTransaction')) {
    const dateRaw = _innerValue(_extractFirst(block, 'transactionDate'));
    const codingBlock = _extractFirst(block, 'transactionCoding') || '';
    const codeRaw = _innerValue(_extractFirst(codingBlock, 'transactionCode'));
    const amounts = _extractFirst(block, 'transactionAmounts') || '';
    const sharesRaw = _innerValue(_extractFirst(amounts, 'transactionShares'));
    const priceRaw = _innerValue(_extractFirst(amounts, 'transactionPricePerShare'));
    const acqDisp = _innerValue(_extractFirst(amounts, 'transactionAcquiredDisposedCode'));
    const shares = sharesRaw != null ? parseFloat(sharesRaw) : null;
    const price = priceRaw != null ? parseFloat(priceRaw) : null;
    // Tag A1: post-transaction holdings —
    //   <postTransactionAmounts><sharesOwnedFollowingTransaction><value>N</value>
    const postBlock = _extractFirst(block, 'postTransactionAmounts') || '';
    const ownedRaw = _innerValue(_extractFirst(postBlock, 'sharesOwnedFollowingTransaction'));
    const owned = ownedRaw != null ? parseFloat(ownedRaw) : null;
    if (!dateRaw || !codeRaw) continue;

    // audit/fix BH-023: prefer THIS transaction's own footnote reference(s)
    // over the filing-wide blob match — a mixed filing (some rows plan-based,
    // some discretionary) must not tag every row as 10b5-1 just because SOME
    // footnote somewhere in the filing mentions it. Only fall back to the
    // filing-wide signal (structured checkbox or any footnote) when this
    // transaction carries no footnote reference of its own to disambiguate.
    const txnFootnoteIds = _txnFootnoteIds(block);
    const isTenB5One = txnFootnoteIds.length > 0
      ? txnFootnoteIds.some(id => /10b5-?\s?1/i.test(footnoteMap[id] || ''))
      : (structuredAff10b5One || anyFootnoteMentions10b51);

    txns.push({
      transactionDate: dateRaw,
      transactionCode: codeRaw,       // P=purchase, S=sale, A=award, M=exercise, etc.
      acquiredDisposed: acqDisp || null, // A=acquired, D=disposed
      transactionShares: Number.isFinite(shares) ? shares : null,
      transactionPricePerShare: Number.isFinite(price) ? price : null,
      sharesOwnedFollowingTransaction: Number.isFinite(owned) ? owned : null,
      reportingPersonName: personName,
      reportingPersonRelationship: relationship,
      owners: owners,
      issuerTradingSymbol: issuerTradingSymbol,
      periodOfReport: periodOfReport,
      isTenB5One: isTenB5One
    });
  }
  return txns;
}

// ─── Submissions index → filings list ───────────────────────────────────
function _normalizeSubmissions(subJson) {
  // The submissions JSON has a `filings.recent` block with parallel
  // arrays (`form`, `filingDate`, `accessionNumber`, `primaryDocument`,
  // …). We zip them into one row per filing.
  const recent = subJson && subJson.filings && subJson.filings.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const rows = [];
  for (let i = 0; i < recent.form.length; i++) {
    rows.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i]
    });
  }
  return rows;
}

function _withinLookback(filingDateStr, lookbackDays) {
  if (!filingDateStr) return false;
  const t = Date.parse(filingDateStr);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= lookbackDays * 86400000;
}

// F-007 (audit 2026-06-08): `filings.recent` holds only the most recent ~1000
// filings. For high-volume issuers that spans LESS than the lookback window —
// Form 4s older than the block were silently dropped, biasing the insider
// signal toward filing-heavy periods. When the oldest `recent` row is still
// inside the window, pull the paginated older pages (filings.files[]) that
// overlap the window and append their rows. Page fetches are best-effort:
// a failed page leaves the recent rows usable.
// F-CGPT-028 (P1-Welle 9, 10.08.2026): `stat` traegt die verschluckten Abruf-Ausfaelle
// nach draussen. Der Zaehler sitzt HIER — in der gemeinsamen Funktion — und nicht beim
// Aufrufer: sonst muss jeder kuenftige Aufrufer daran denken, und genau das passiert nicht.
async function _filingsCoveringLookback(subJson, lookbackDays, stat = { fetchFailures: 0 }) {
  let rows = _normalizeSubmissions(subJson);
  const files = (subJson && subJson.filings && Array.isArray(subJson.filings.files))
    ? subJson.filings.files : [];
  if (files.length === 0 || rows.length === 0) return rows;
  const oldestRecent = rows[rows.length - 1] && rows[rows.length - 1].filingDate;
  // recent already reaches past the window → nothing older needed
  if (!oldestRecent || !_withinLookback(oldestRecent, lookbackDays)) return rows;
  // F-F4-003 (audit 2026-06-11): hard cap on older-page fetches per ticker. The
  // window-overlap skip (filingTo) normally bounds this, but a CIK with malformed/
  // missing filingTo metadata could otherwise walk every historical page. The
  // 180d window needs at most ~1-2 extra 1000-filing pages even for the busiest
  // filers, so 4 is generous insurance against a runaway request loop.
  const MAX_OLDER_PAGES = 4;
  let pagesFetched = 0;
  for (const fmeta of files) {
    if (!fmeta || !fmeta.name) continue;
    // skip pages whose newest filing predates the window entirely
    if (fmeta.filingTo && !_withinLookback(fmeta.filingTo, lookbackDays)) continue;
    if (pagesFetched >= MAX_OLDER_PAGES) break;
    pagesFetched++;
    try {
      const pageRes = await httpGet('https://data.sec.gov/submissions/' + fmeta.name);
      await sleep(RATE_DELAY_MS);
      // Eine Seite, die die SEC selbst in filings.files[] nennt, MUSS es geben — fehlt
      // sie oder kommt sie leer, ist das ein Ausfall, kein "es gab da nichts".
      if (pageRes.notFound || !pageRes.body) { stat.fetchFailures++; continue; }
      const pageJson = JSON.parse(pageRes.body);
      // older pages carry the parallel arrays at top level (same shape as `recent`)
      rows = rows.concat(_normalizeSubmissions({ filings: { recent: pageJson } }));
    } catch (e) {
      // best-effort bleibt best-effort (die recent-Zeilen sind weiter brauchbar) — aber
      // der Ausfall wird gezaehlt: sonst sieht ein verkuerztes Fenster spaeter aus wie
      // "dieser Insider hat nicht gehandelt".
      stat.fetchFailures++;
    }
  }
  return rows;
}

// ─── Per-ticker pull ────────────────────────────────────────────────────
async function pullTickerForm4(ticker, cikInfo) {
  const cik = cikInfo.cik;
  // 1. Pull submissions index for the CIK.
  const subRes = await httpGet(SEC_SUBMISSIONS_URL(cik));
  await sleep(RATE_DELAY_MS);
  if (subRes.notFound) {
    return { transactions: [], error: 'submissions-404' };
  }
  let subJson;
  try { subJson = JSON.parse(subRes.body); }
  catch (e) { return { transactions: [], error: 'submissions-parse: ' + e.message }; }

  // F-007: cover the FULL lookback window, following pagination when needed.
  const stat = { fetchFailures: 0 };
  const allRows = await _filingsCoveringLookback(subJson, FORM4_LOOKBACK_DAYS, stat);
  const filings = allRows
    .filter(f => f.form === '4' && _withinLookback(f.filingDate, FORM4_LOOKBACK_DAYS));

  const transactions = [];
  let parseErrors = 0;
  for (const f of filings) {
    const accNoDash = (f.accessionNumber || '').replace(/-/g, '');
    if (!accNoDash || !f.primaryDocument) continue;
    // The primaryDocument SEC returns for Form 4 is *usually* a path like
    // `xslF345X06/form4.xml` — that's the XSLT-rendered HTML view, not the
    // raw XBRL XML. The raw XML always sits as a sibling at the bare
    // filename one directory up. Stripping any leading directory in the
    // primaryDocument path normalises to the raw XML. (If a future filing
    // uses a primaryDocument that's already at the bare-filename level,
    // basename() is a no-op.) Non-.xml primaries (HTML-only summary
    // attachments) are dropped — they carry no structured data.
    const docName = f.primaryDocument.split('/').pop();
    if (!docName || !/\.xml$/i.test(docName)) continue;

    const docUrl = SEC_ARCHIVE_URL(cik, accNoDash, docName);
    let docRes;
    try { docRes = await httpGet(docUrl); }
    catch (e) {
      // F-CGPT-028: Netzfehler/403/429/5xx beim Dokument-Abruf sind ein AUSFALL. Sie
      // blieben hier stumm, der Ticker lief mit frischem fetchedAt in den Erfolgs-Zweig,
      // und die 24h-TTL fror den verkuerzten Stand ein. Ein 404 auf das Dokument zaehlt
      // bewusst NICHT (Zeile unten): der Rohpfad wird aus primaryDocument abgeleitet und
      // kann strukturell danebenliegen — das waere kein Ausfall, sondern Normalbetrieb.
      stat.fetchFailures++;
      await sleep(RATE_DELAY_MS);
      continue;
    }
    await sleep(RATE_DELAY_MS);
    if (docRes.notFound || !docRes.body) continue;
    try {
      const txns = parseForm4Xml(docRes.body);
      for (const t of txns) {
        t.accessionNumber = f.accessionNumber;
        t.filingDate = f.filingDate;
        transactions.push(t);
      }
    } catch (e) {
      // audit/fix BH-026: count swallowed per-filing parse errors so main()
      // can tell "this ticker legitimately has zero Form 4 activity" apart
      // from "every filing we fetched failed to parse" and avoid clobbering
      // a prior good cache entry with an empty one in the latter case.
      parseErrors++;
      continue;
    }
  }
  return { transactions, filingsScanned: filings.length, parseErrors, fetchFailures: stat.fetchFailures };
}

// ─── Watchlist filter ───────────────────────────────────────────────────
function selectUsTickers(watchlist, tickerCikMap) {
  // Pattern-based: a watchlist entry is US-listed iff its `ticker` field
  // matches an entry in the SEC ticker→CIK map. No exchange_hint guesswork
  // and no hardcoded suffix list — the SEC map is authoritative.
  const stocks = Array.isArray(watchlist && watchlist.stocks) ? watchlist.stocks : [];
  const matched = [];
  for (const s of stocks) {
    const t = (s.ticker || s.yahoo_symbol || '').toUpperCase().trim();
    if (!t) continue;
    // Skip any ticker carrying a non-US exchange suffix (`.SZ`, `.TO`, …).
    // The SEC map keys are bare symbols (`AAPL`, `BRK.B`); a `.` in the
    // middle of the ticker that doesn't appear in the map means it's
    // probably a foreign listing or share class we don't have a CIK for.
    if (tickerCikMap[t]) matched.push({ ticker: t, cikInfo: tickerCikMap[t] });
  }
  return matched;
}

// audit/fix BH-026: pulled out as a pure predicate so the "preserve prior
// cache entry" decision is unit-testable without mocking the SEC network calls.
function _isAllParseFailure(result) {
  return result.transactions.length === 0 && (result.parseErrors || 0) > 0;
}

// F-CGPT-028: EIN Grund fuer alle weichen Ausfaelle eines Tickers — null heisst
// "sauber gemessen". fetchFailures zaehlt AUCH dann, wenn Transaktionen dabei sind:
// ein Ticker, dessen aeltere Filing-Seite ausfiel, hat ein verkuerztes Fenster, und
// genau dieses verkuerzte Fenster wuerde sonst mit frischem fetchedAt fuer 24 h als
// vollstaendige Messung gelten ("kein Insider-Handel").
function _softAusfallGrund(result) {
  if (_isAllParseFailure(result)) return 'all-filings-unparsable(' + result.parseErrors + ')';
  if ((result.fetchFailures || 0) > 0) return 'fetch-failures(' + result.fetchFailures + ')';
  return null;
}

// Cache-Eintrag nach einem weichen Ausfall: failedAt statt fetchedAt, und der letzte
// gute Stand (fetchedAt + transactions) bleibt unangetastet — sonst ersetzt ein Ausfall
// echte Historie durch Leere und die 24h-TTL sperrt den Nachholversuch aus.
//
// Welle-9-Nachzug (Review 10.08.2026): bei einem TEIL-Ausfall (aeltere Filing-Seite faellt
// aus, die recent-Filings liefern aber gueltige Transaktionen) waren die frisch geholten
// Transaktionen bisher weg — der Eintrag wurde ausschliesslich aus `prev` gebaut. Deshalb
// nimmt `neueTransaktionen` sie mit auf. Zwei Dinge bleiben dabei bewusst so:
//   * KEIN fetchedAt. Der Stand ist verkuerzt; mit frischem fetchedAt wuerde die 24h-TTL
//     den Nachholversuch aussperren und aus dem Ausfall ein Messergebnis machen.
//   * Der alte Stand wird nicht ueberschrieben, sondern ergaenzt: alles aus `prev`, dessen
//     Filing (accessionNumber) dieser Lauf NICHT gesehen hat, bleibt stehen. Ein bloss
//     ersetzender Schreibvorgang haette bei einem tagelang ausfallenden aelteren Seiten-
//     Abruf die Historie Lauf fuer Lauf auf das kurze Fenster eingedampft — derselbe stille
//     Verlust, den diese Welle abstellt.
function _ausfallEintrag(prev, ticker, cikInfo, grund, neueTransaktionen) {
  const eintrag = Object.assign({}, prev || {}, {
    ticker,
    cik: cikInfo.cik,
    name: cikInfo.name,
    failedAt: new Date().toISOString(),
    error: grund,
  });
  const neu = Array.isArray(neueTransaktionen) ? neueTransaktionen : [];
  if (neu.length) {
    const alt = Array.isArray(prev && prev.transactions) ? prev.transactions : [];
    const gesehen = new Set(neu.map((t) => t.accessionNumber));
    eintrag.transactions = neu.concat(alt.filter((t) => !gesehen.has(t.accessionNumber)));
  }
  return eintrag;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  ensureDir(EXTERNAL_DIR);

  const watchlist = readJsonSafe(WATCHLIST_PATH);
  if (!watchlist || !Array.isArray(watchlist.stocks)) {
    console.error('watchlist.json missing or malformed (.stocks[] required) — aborting');
    process.exit(1);
  }

  const tickerCikMap = await loadTickerCikMap();
  let usTickers = selectUsTickers(watchlist, tickerCikMap);
  console.log('  [watchlist] ' + watchlist.stocks.length + ' total → ' +
    usTickers.length + ' US-listed (CIK known)');

  if (SAMPLE_LIMIT) {
    usTickers = usTickers.slice(0, SAMPLE_LIMIT);
    console.log('  [sample] SAMPLE_LIMIT=' + SAMPLE_LIMIT + ' → processing first ' +
      usTickers.length + ' tickers');
  }

  // Load existing cache so we can honour the per-ticker TTL.
  const existing = ladeForm4Cache();
  const byTicker = (existing && existing.byTicker && typeof existing.byTicker === 'object')
    ? existing.byTicker : {};

  let fetched = 0, skippedFresh = 0, errors = 0, totalTxns = 0;
  for (const { ticker, cikInfo } of usTickers) {
    const prev = byTicker[ticker];
    if (prev && prev.fetchedAt &&
        (Date.now() - new Date(prev.fetchedAt).getTime()) < CACHE_TTL_MS) {
      skippedFresh++;
      totalTxns += Array.isArray(prev.transactions) ? prev.transactions.length : 0;
      continue;
    }
    try {
      const result = await pullTickerForm4(ticker, cikInfo);
      if (result.error) {
        // audit/fix: soft errors (submissions-404 / submissions-parse) returned
        // WITHOUT throwing must NOT get a fresh fetchedAt — otherwise the 24h
        // freshness gate (line ~454) skips this ticker for a full TTL window
        // even though we got NO data. Mirror the thrown-error path below: stamp
        // failedAt, preserve any prior successful pull's fetchedAt so the next
        // run retries this ticker immediately. Like the thrown-error path, we
        // also do NOT overwrite transactions: a transient 404/parse-error must
        // not clobber a prior successful pull's cached insider transactions
        // (red-team A1: asymmetric data-loss vs the catch path otherwise).
        errors++;
        // _ausfallEintrag setzt bewusst KEIN fetchedAt und KEINE transactions —
        // der letzte gute Stand bleibt stehen (mirrors the thrown-error path).
        byTicker[ticker] = _ausfallEintrag(prev, ticker, cikInfo, result.error);
        console.warn('  [' + ticker + '] soft-error: ' + result.error);
        continue;
      }
      // audit/fix BH-026: if EVERY filing we fetched for this ticker failed
      // to parse (0 transactions but parseErrors>0), don't overwrite the
      // cache with a fresh-but-empty entry — that would silently erase any
      // previously-cached good transactions under a shiny new fetchedAt.
      // Preserve the prior entry (same pattern as the soft-error branch
      // above) and retry next run.
      // F-CGPT-028 (P1-Welle 9): derselbe Zweig faengt jetzt auch verschluckte
      // Netz-/Seiten-Ausfaelle (fetchFailures) — ein nicht geholtes Filing ist kein
      // gemessenes "kein Insider-Handel". Beide Faelle: failedAt, alter Stand bleibt,
      // naechster Lauf holt nach (kein fetchedAt -> die 24h-TTL greift nicht).
      // Die frisch geholten Transaktionen gehen MIT in den Ausfall-Eintrag (Welle-9-
      // Nachzug): ein Teil-Ausfall darf gueltige neue Filings nicht verwerfen. failedAt
      // bleibt, fetchedAt bleibt aus — der naechste Lauf holt das fehlende Stueck nach.
      const softGrund = _softAusfallGrund(result);
      if (softGrund) {
        errors++;
        byTicker[ticker] = _ausfallEintrag(prev, ticker, cikInfo, softGrund, result.transactions);
        console.warn('  [' + ticker + '] soft-error: ' + softGrund +
          ' (neue Transaktionen: ' + (result.transactions || []).length + ')');
        continue;
      }
      byTicker[ticker] = {
        ticker,
        cik: cikInfo.cik,
        name: cikInfo.name,
        fetchedAt: new Date().toISOString(),
        filingsScanned: result.filingsScanned || 0,
        transactions: result.transactions || [],
        error: result.error || null
      };
      fetched++;
      totalTxns += result.transactions.length;
      console.log('  [' + ticker + '] CIK=' + cikInfo.cik + ' filings=' +
        (result.filingsScanned || 0) + ' txns=' + result.transactions.length +
        (result.error ? ' ERR=' + result.error : ''));
    } catch (e) {
      // audit/fix: 429 IP-block backoff. On a rate-limit (429) or 503, back off
      // 30 s and retry this ticker WITHOUT incrementing the abort/error counter
      // and WITHOUT stamping a fresh failedAt/fetchedAt on the cache entry — the
      // ticker simply isn't processed this pass and is retried next run. Counting
      // a 429 as an error would burn the abort budget (>25) on a transient
      // throttle and the normal cadence would keep hammering SEC into an IP block.
      if (e && (e.statusCode === 429 || e.statusCode === 503)) {
        console.warn('  [' + ticker + '] rate-limited (HTTP ' + e.statusCode +
          ') — backing off ' + (RATE_LIMIT_BACKOFF_MS / 1000) + 's');
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      errors++;
      // Tag 211j (audit MEDIUM): use failedAt (NOT fetchedAt) when the
      // pull errored — the freshness gate at line ~387 checks fetchedAt
      // and would otherwise skip this ticker for the full TICKER_MAP_TTL_MS
      // window even though we never got any data. Preserve any prior
      // successful pull's fetchedAt + transactions so the cache doesn't
      // regress on transient SEC outages.
      byTicker[ticker] = Object.assign({}, prev || {}, {
        ticker,
        cik: cikInfo.cik,
        failedAt: new Date().toISOString(),
        lastError: e.message
        // intentionally NOT setting fetchedAt — preserve prior successful
        // pull's value (if any) so the cache reflects "last good fetch"
        // and the next run retries this ticker immediately.
      });
      console.warn('  [' + ticker + '] ERROR: ' + e.message);
      // Be defensive: if too many errors in a row, the IP might be rate-
      // limited. Bail rather than burn the rest of the watchlist.
      if (errors > 25) {
        console.error('  too many errors (>25) — aborting early to be polite to SEC');
        break;
      }
    }
    // After every ticker, atomically re-write the full cache. This makes
    // the script resumable — Ctrl-C at any point leaves a valid cache.
    writeFileAtomic(FORM4_CACHE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      userAgentSource: 'process.env.SEC_CONTACT',
      lookbackDays: FORM4_LOOKBACK_DAYS,
      byTicker
    }, null, 2));
  }

  console.log('');
  console.log('Done. fetched=' + fetched + ' skipped(fresh)=' + skippedFresh +
    ' errors=' + errors + ' totalTxns=' + totalTxns);
  console.log('Cache: ' + FORM4_CACHE_PATH);

  // audit/fix: 403 silent exit-0. If NOTHING succeeded but errors occurred
  // (fetched === 0 && errors > 0) the run was a total failure — typically a
  // systemic 403/UA/IP-block outage rather than scattered per-ticker hiccups.
  // Exit non-zero so CI surfaces it instead of a green run over an empty cache.
  if (fetched === 0 && errors > 0) {
    console.error('TOTAL FAILURE: 0 tickers fetched with ' + errors +
      ' error(s) — likely a systemic SEC outage / 403 / IP block. Exiting 1.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  parseForm4Xml, selectUsTickers, loadTickerCikMap, ladeForm4Cache,
  _internals: {
    httpGet, _normalizeSubmissions, _withinLookback, _isAllParseFailure,
    // F-CGPT-028: exportiert, damit der Ausfall-Pfad ohne echtes SEC-Netz fahrbar ist.
    pullTickerForm4, _filingsCoveringLookback, _softAusfallGrund, _ausfallEintrag,
  },
  _secRateLimit: SEC_RATE_LIMIT
};
