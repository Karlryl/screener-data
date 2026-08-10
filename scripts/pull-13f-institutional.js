#!/usr/bin/env node
/**
 * Tag 212e: SEC EDGAR Form 13F-HR Institutional-Ownership Puller
 * ==============================================================
 * Fetches the latest quarterly Form 13F-HR filings for a curated list of
 * well-known institutional managers (Berkshire, BlackRock, Vanguard, etc.),
 * parses the information_table.xml position lists, and writes them to
 * `external-data/sec-13f-cache.json` keyed by institution CIK.
 *
 * Also writes a derived `external-data/sec-13f-by-ticker.json` view that
 * groups all institutional positions by CUSIP / issuer name → "what
 * institutions own MSFT?" lookups for future downstream methods.
 *
 * Why this exists: Form 13F discloses ALL equity holdings for managers
 * >$100M. Tracking ownership concentration / accumulation across quarters
 * gives a high-quality fundamental signal (big-money in = bullish, out =
 * bearish) that complements Tag 210e's Form 4 insider feed.
 *
 * BH-028 fix: `byInstitution[cik].quarters[reportPeriod]` holds one entry
 * PER quarter (SEC `reportDate`/periodOfReport), so a successful refresh no
 * longer discards the prior quarter's book — the flat top-level fields
 * (`positions`, `filingDate`, ...) still mirror the latest quarter only, for
 * back-compat with readers written before this fix. Cross-quarter
 * accumulation reads `quarters`, not the flat fields.
 * BH-029/BH-030 fix: amendment (13F-HR/A) handling is scoped to filings that
 * share the SAME SEC reportDate as the base filing, and full-book-vs-partial
 * is decided from the cover page's <amendmentType> (RESTATEMENT/NEW
 * HOLDINGS) when available — the position-count ratio is a fallback only.
 * BH-033 fix: both output files carry a `status` field ('active' vs
 * 'research-inactive') so a sparse/stale store doesn't silently look like
 * real institutional coverage.
 *
 * Mirrors the Tag 210e pattern (pull-insider-form4.js):
 *   - SEC EDGAR submissions JSON → latest filing per institution
 *   - regex-based XML parsing (no extra deps)
 *   - 125 ms throttle (≈8 req/s; under SEC's 10/s/IP limit)
 *   - real User-Agent (post-Tag-211j fix; SEC ToU requires contact)
 *   - atomic writes via lib/atomic-write.js
 *   - per-institution cache TTL (idempotent / resumable)
 *   - Tag 211j errored-pull pattern: write `failedAt` (NOT `fetchedAt`)
 *     so the freshness gate retries on the next run
 *
 * CRITICAL inversion vs Tag 210e:
 *   Form 4 is indexed by COMPANY (one company → many insiders' filings).
 *   Form 13F is indexed by INSTITUTION (one institution → one quarterly
 *   filing listing every position). So inputs/outputs flip:
 *     - Input: hardcoded list of ~50 institutional CIKs (bootstrap below)
 *     - Output: cache keyed by institution_cik
 *     - Derived: ticker/issuer → institutions-holding view
 *
 * Run locally (single institution smoke test):
 *   & "C:\Program Files\nodejs\node.exe" scripts/pull-13f-institutional.js --cik-list 0001067983
 *
 * Run full list:
 *   & "C:\Program Files\nodejs\node.exe" scripts/pull-13f-institutional.js
 *
 * NOT wired into daily-pull.yml. Standalone manual-only (Tag 210e disposition).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const { writeFileAtomic } = require('../lib/atomic-write.js');

// ─── Config ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const EXTERNAL_DIR = path.join(ROOT, 'external-data');
const TICKER_CIK_MAP_PATH = path.join(EXTERNAL_DIR, 'sec-ticker-cik-map.json');
const DEFAULT_CACHE_PATH = path.join(EXTERNAL_DIR, 'sec-13f-cache.json');
const BY_TICKER_PATH = path.join(EXTERNAL_DIR, 'sec-13f-by-ticker.json');

const SEC_SUBMISSIONS_URL = cik => `https://data.sec.gov/submissions/CIK${cik}.json`;
const SEC_ARCHIVE_DIR_URL = (cik, accNoDash) =>
  `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/`;
const SEC_ARCHIVE_FILE_URL = (cik, accNoDash, doc) =>
  `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/${doc}`;
const SEC_ARCHIVE_INDEX_JSON = (cik, accNoDash) =>
  `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/index.json`;

// Tag 211j: real contact — SEC silently rate-limits fake addresses.
const USER_AGENT = require('../lib/sec-user-agent').secUserAgent();
const SEC_RATE_LIMIT = require('../lib/sec-rate-limit.js');

// 125 ms ≈ 8 req/s (SEC limit: 10/s/IP).
const { RATE_DELAY_MS, RATE_LIMIT_BACKOFF_MS } = SEC_RATE_LIMIT;

// audit/fix: 429 IP-block backoff. On HTTP 429 (rate-limited) or 503 SEC wants
// the client to slow WAY down — a normal 125 ms cadence keeps tripping the
// 10/s/IP limit and risks a ~10-min IP block. Wait 30 s and retry the
// institution WITHOUT counting it as an abort-budget error.
// 13F-HR filings are quarterly (45-day deadline post-quarter-end). A 100-day
// TTL means we refresh roughly once per quarter, which matches the data's
// natural cadence.
const DEFAULT_MAX_AGE_DAYS = 100;

// audit F-A-2026-06-22: retry TTLs for FAILED pulls. A soft-error (or thrown)
// pull must NOT be treated fresh for the full quarter (DEFAULT_MAX_AGE_DAYS) —
// that starves the by-ticker view for ~100 days. Transient failures (404 on a
// specific info table, parse failure, timeout, rate-limit) retry quickly; a
// genuinely permanent failure (CIK has no 13F-HR filings at all / submissions
// 404) backs off harder to spare SEC, but still re-checks long before the
// fresh TTL so a CIK that begins filing 13F is eventually picked up.
const ERROR_RETRY_DAYS = 3;
const PERMANENT_ERROR_RETRY_DAYS = 30;

// Per-institution position-count sanity ceiling. BlackRock / Vanguard 13F
// filings can list 5,000+ positions; we cap parsing at 20,000 to keep cache
// size bounded and reject obviously-corrupt filings without OOM risk.
const MAX_POSITIONS_PER_FILING = 20000;

// BH-030 fix: FALLBACK ONLY. The primary amendment-type decision now reads
// the SEC cover page's <amendmentType> (RESTATEMENT vs NEW HOLDINGS) — see
// _fetchAmendmentType(). This ratio is used only when the cover page can't
// be fetched/parsed (network hiccup, unexpected schema). Named + hoisted to
// config (previously a function-local magic number) per audit finding.
const AMENDMENT_MIN_RATIO_FALLBACK = 0.5;

// BH-033 fix: below this many institutions with a live (non-errored,
// non-empty) positions array, the store is too sparse to represent as
// trustworthy "institutional coverage" — output is stamped research-inactive
// instead of silently looking like a real cross-section. 10 is a low bar on
// purpose: the curated bootstrap list has 40 institutions, so single-digit
// live coverage is already a clear red flag on its own.
const RESEARCH_ACTIVE_MIN_INSTITUTIONS = 10;
// Das Frische-Fenster des Status ist BEWUSST dasselbe wie das Freshness-Gate des Pulls
// (DEFAULT_MAX_AGE_DAYS bzw. --max-age-days). Eine eigene Konstante daneben war ein
// unheilbarer Widerspruch: mit `--max-age-days 200` galt ein 150 Tage alter Eintrag beim
// Pull als "fresh uebersprungen" und beim Status gleichzeitig als stale — der Lauf konnte
// nie gruen werden, egal wie oft man ihn startete. Ein 13F-Quartal wird spaetestens 45 Tage
// nach Quartalsende gemeldet; die 100 Tage Default decken Quartalswechsel plus Frist ab.

// ─── Bootstrap institution list ─────────────────────────────────────────
// Hardcoded list of well-known institutional managers. CIKs are SEC-padded
// 10-digit strings. This list is the "starting set"; expand by editing
// here or by passing --cik-list on the CLI.
//
// Verified via https://efts.sec.gov/LATEST/search-index?forms=13F-HR&q=<name>
// where possible; CIKs marked PLACEHOLDER need verification before the data
// is trusted downstream.
// F-008 (audit 2026-06-08): all rows previously marked "(placeholder)" carried
// GUESSED CIKs — most reused another institution's CIK (the first-wins de-dupe
// silently dropped them), but 0001029160 was actually fetched under the wrong
// name ("Citigroup Inc (placeholder)") and ExxonMobil is not a 13F institution
// at all. Every placeholder row + Exxon removed; the remaining CIKs were all
// entered as real, intended filers. To re-add an institution, verify the CIK
// via https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=13F-HR first.
const BOOTSTRAP_INSTITUTIONS = [
  { cik: '0001067983', name: 'Berkshire Hathaway Inc' },
  { cik: '0001364742', name: 'BlackRock Inc' },
  { cik: '0000102909', name: 'Vanguard Group Inc' },
  { cik: '0000093751', name: 'State Street Corp' },
  { cik: '0000895421', name: 'Morgan Stanley' },
  { cik: '0000886982', name: 'Goldman Sachs Group Inc' },
  { cik: '0000019617', name: 'JPMorgan Chase & Co' },
  { cik: '0000070858', name: 'Bank of America Corp' },
  { cik: '0000831001', name: 'Citigroup Inc' },
  { cik: '0001037389', name: 'Renaissance Technologies LLC' },
  { cik: '0001350694', name: 'Bridgewater Associates LP' },
  { cik: '0001423053', name: 'Citadel Advisors LLC' },
  { cik: '0001179392', name: 'Two Sigma Investments LP' },
  { cik: '0001027796', name: 'Soros Fund Management LLC' },
  { cik: '0001061768', name: 'Tudor Investment Corp' },
  { cik: '0001656456', name: 'Pershing Square Capital Management LP' },
  { cik: '0001167483', name: 'Greenlight Capital Inc' },
  { cik: '0001540531', name: 'Third Point LLC' },
  { cik: '0001135730', name: 'ValueAct Holdings LP' },
  { cik: '0001100663', name: 'Lone Pine Capital LLC' },
  { cik: '0001541617', name: 'Tiger Global Management LLC' },
  { cik: '0001056831', name: 'Coatue Management LLC' },
  { cik: '0001517137', name: 'Viking Global Investors LP' },
  { cik: '0001633313', name: 'Baupost Group LLC' },
  { cik: '0001009207', name: 'D. E. Shaw & Co LP' },
  { cik: '0001167557', name: 'AQR Capital Management LLC' },
  { cik: '0000898437', name: 'Wellington Management Group LLP' },
  { cik: '0000315066', name: 'Fidelity Management & Research (FMR LLC)' },
  { cik: '0000200217', name: 'T. Rowe Price Group Inc' },
  { cik: '0000354204', name: 'Capital Research Global Investors' },
  { cik: '0000810893', name: 'PRIMECAP Management Co' },
  { cik: '0001112520', name: 'Sequoia Fund Inc' },
  { cik: '0001364750', name: 'Susquehanna International Group LLP' },
  { cik: '0001273087', name: 'Millennium Management LLC' },
  { cik: '0001553733', name: 'Point72 Asset Management LP' },
  { cik: '0001603466', name: 'Element Capital Management LLC' },
  { cik: '0001602119', name: 'Balyasny Asset Management LP' },
  { cik: '0001262039', name: 'Dodge & Cox' },
  { cik: '0000093750', name: 'Franklin Resources Inc' },
  { cik: '0000832988', name: 'Invesco Ltd' }
];

// ─── Tiny utils ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Pad a raw CIK ("1067983", "0001067983", 1067983) to the 10-digit
// zero-padded form SEC requires for the submissions endpoint.
function padCik(cik) {
  return String(cik || '').replace(/[^0-9]/g, '').padStart(10, '0');
}

// Same redirect-cap pattern as Tag 210e (lifted verbatim).
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
      // per-institution loop could not detect a 429 to back off (kept hammering
      // SEC at normal cadence → ~10-min IP block) nor a systemic 403 outage.
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

// ─── 13F XML parser ─────────────────────────────────────────────────────
// SEC 13F information_table.xml has repeated <infoTable> blocks. Each one
// is a flat set of issuer / cusip / value / shares fields. Namespace
// prefixes vary across filers (ns1:, n1:, ., or none) so we strip any
// prefix in the tag-match regex.

function _extractAll(xml, tag) {
  // (?:\w+:)? tolerates any namespace prefix on either the open or close.
  const re = new RegExp(
    '<(?:\\w+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?' + tag + '>',
    'g'
  );
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function _extractFirst(xml, tag) {
  const all = _extractAll(xml, tag);
  return all.length ? all[0] : null;
}

function _text(s) {
  if (s == null) return null;
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function _num(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// audit F-A-2026-06-22: prevents silent truncation of large 13F books going
// undetected downstream. Returns the parsed positions PLUS truncation
// telemetry: when the MAX_POSITIONS_PER_FILING cap trips on a large filer
// (Vanguard/BlackRock 5,000+ positions) the result now carries
// `truncated: true` along with `blocksSeen`/`positionsParsed` so the cap is
// recorded in the cache entry and a WARN is logged, rather than the position
// list being silently cut with no flag.
function _parse13fXmlDetailed(xml) {
  if (!xml || typeof xml !== 'string') {
    return { positions: [], truncated: false, blocksSeen: 0, positionsParsed: 0 };
  }
  const blocks = _extractAll(xml, 'infoTable');
  const blocksSeen = blocks.length;
  const positions = [];
  let truncated = false;
  for (const block of blocks) {
    if (positions.length >= MAX_POSITIONS_PER_FILING) {
      truncated = true;
      console.warn('  [WARN] 13F info table truncated at MAX_POSITIONS_PER_FILING=' +
        MAX_POSITIONS_PER_FILING + ' (blocksSeen=' + blocksSeen +
        '); position list capped — large filer underreported');
      break;
    }
    try {
      const nameOfIssuer = _text(_extractFirst(block, 'nameOfIssuer'));
      const titleOfClass = _text(_extractFirst(block, 'titleOfClass'));
      const cusip = _text(_extractFirst(block, 'cusip'));
      const value = _num(_text(_extractFirst(block, 'value')));
      const shrsBlock = _extractFirst(block, 'shrsOrPrnAmt') || '';
      const sshPrnamt = _num(_text(_extractFirst(shrsBlock, 'sshPrnamt')));
      const sshPrnamtType = _text(_extractFirst(shrsBlock, 'sshPrnamtType'));
      const putCall = _text(_extractFirst(block, 'putCall'));
      const investmentDiscretion = _text(_extractFirst(block, 'investmentDiscretion'));
      // Skip entries with no issuer name OR no cusip — they're useless
      // for the by-ticker view. Don't reject on missing value/shares
      // (some manual filers leave them blank for cash-equivalent rows).
      if (!nameOfIssuer || !cusip) continue;
      positions.push({
        nameOfIssuer,
        titleOfClass: titleOfClass || null,
        cusip,
        value,               // reported in thousands USD per SEC schema
        sshPrnamt,           // shares OR principal amount
        sshPrnamtType: sshPrnamtType || null, // 'SH' shares / 'PRN' principal
        putCall: putCall || null,
        investmentDiscretion: investmentDiscretion || null
      });
    } catch (e) {
      // Per spec: don't block on per-entry parse failures.
      continue;
    }
  }
  return { positions, truncated, blocksSeen, positionsParsed: positions.length };
}

// Backward-compatible thin wrapper: returns the bare positions array (the
// public contract relied on by tests/13f-test.js, which asserts Array.isArray
// and .length). Internal callers use _parse13fXmlDetailed for truncation meta.
function parse13fXml(xml) {
  return _parse13fXmlDetailed(xml).positions;
}

// ─── Submissions index helpers ──────────────────────────────────────────
function _normalizeSubmissions(subJson) {
  const recent = subJson && subJson.filings && subJson.filings.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const rows = [];
  for (let i = 0; i < recent.form.length; i++) {
    rows.push({
      form: recent.form[i],
      filingDate: recent.filingDate[i],
      // BH-029 fix: reportDate is SEC's periodOfReport (the quarter the
      // filing COVERS, e.g. "2026-06-30"), distinct from filingDate (when it
      // was FILED, e.g. "2026-12-01" for a late amendment). Selecting by
      // filingDate alone can pick a late amendment for an OLD quarter as
      // "newest" and pair it against a DIFFERENT quarter's base book.
      // Optional-chained defensively: absent on older cached submissions
      // fixtures / if SEC ever omits it, callers fall back to filingDate.
      reportDate: recent.reportDate ? recent.reportDate[i] : undefined,
      accessionNumber: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i]
    });
  }
  return rows;
}

function _institutionName(subJson) {
  if (!subJson) return null;
  return subJson.name || (subJson.entityName) || null;
}

// Given a filing accession number, locate the information_table.xml within
// the filing's archive directory. The primaryDocument is usually the cover
// page (`primary_doc.xml` or similar), NOT the info-table. We fetch the
// filing's index.json which lists every attached document and pick the
// one whose name contains "infotable" / "information_table" and ends .xml.
async function findInfoTableUrl(cik, accNoDash) {
  const idxRes = await httpGet(SEC_ARCHIVE_INDEX_JSON(cik, accNoDash));
  await sleep(RATE_DELAY_MS);
  if (idxRes.notFound || !idxRes.body) return null;
  let idxJson;
  try { idxJson = JSON.parse(idxRes.body); }
  catch (e) { return null; }
  const items = idxJson && idxJson.directory && Array.isArray(idxJson.directory.item)
    ? idxJson.directory.item : [];
  // Preference order:
  //   1. exact "information_table.xml"
  //   2. anything containing "infotable" or "information_table" ending .xml
  //   3. any .xml that's NOT primary_doc.xml (fallback — some filers use
  //      idiosyncratic names)
  let best = null;
  for (const it of items) {
    const n = (it.name || '').toLowerCase();
    if (!n.endsWith('.xml')) continue;
    if (n === 'information_table.xml' || n === 'infotable.xml') {
      best = it.name; break;
    }
    if (!best && (n.includes('infotable') || n.includes('information_table'))) {
      best = it.name;
    }
  }
  if (!best) {
    for (const it of items) {
      const n = (it.name || '').toLowerCase();
      if (n.endsWith('.xml') && n !== 'primary_doc.xml') { best = it.name; break; }
    }
  }
  return best ? SEC_ARCHIVE_FILE_URL(cik, accNoDash, best) : null;
}

// BH-030 fix: read the SEC cover page's actual amendment semantics instead of
// guessing from a position-count ratio. Form 13F-HR/A cover pages
// (primary_doc.xml) carry <amendmentInfo><amendmentType> = "RESTATEMENT"
// (full book replacement) or "NEW HOLDINGS" (additive — only changed/added
// rows). filing.primaryDocument already names this file (from the
// submissions index), so no extra index.json round-trip is needed.
// Returns 'RESTATEMENT' | 'NEW HOLDINGS' | null (unavailable/unparseable —
// caller falls back to AMENDMENT_MIN_RATIO_FALLBACK).
async function _fetchAmendmentType(cik, filing) {
  if (!filing || !filing.primaryDocument || !filing.accessionNumber) return null;
  const acc = filing.accessionNumber.replace(/-/g, '');
  const url = SEC_ARCHIVE_FILE_URL(cik, acc, filing.primaryDocument);
  let res;
  try { res = await httpGet(url); }
  catch (e) { await sleep(RATE_DELAY_MS); return null; }
  await sleep(RATE_DELAY_MS);
  if (res.notFound || !res.body) return null;
  const type = _text(_extractFirst(res.body, 'amendmentType'));
  return type ? type.toUpperCase().trim() : null;
}

// BH-029 fix: pick the target REPORT PERIOD (SEC's reportDate /
// periodOfReport — the quarter a filing COVERS) rather than the most recent
// filingDate. A 13F-HR/A for an OLDER quarter can be filed after a NEWER
// quarter's original (e.g. Q2 original 08-14, Q3 original 11-14, Q2/A filed
// 12-01) — sorting by filingDate alone would treat that late Q2 amendment as
// "newest" and risk pairing it against the Q3 base book. Pure/exported so
// this selection is directly test-covered (tests/scoring/bh-w2-13f.test.js)
// instead of only reachable through a live network pull.
function _selectPeriodFilings(f13s) {
  const withPeriod = f13s.filter(f => f.reportDate);
  const periodSortKey = f => f.reportDate || f.filingDate || '';
  const targetPeriod = withPeriod.length
    ? withPeriod.slice().sort((a, b) => periodSortKey(b).localeCompare(periodSortKey(a)))[0].reportDate
    : null;
  // Filings for the target period only — an amendment may ONLY be merged
  // against a base filing covering the SAME period. If reportDate is
  // unavailable anywhere (older cached submissions shape), degrade to the
  // pre-fix filingDate-only pool rather than crash.
  const periodFilings = (targetPeriod ? f13s.filter(f => f.reportDate === targetPeriod) : f13s.slice())
    .sort((a, b) => (b.filingDate || '').localeCompare(a.filingDate || ''));
  const newest = periodFilings[0] || null;
  const baseFiling = periodFilings.find(f => f.form === '13F-HR') || null;
  const reportPeriod = targetPeriod || (newest && newest.reportDate) || null;
  return { reportPeriod, periodFilings, newest, baseFiling };
}

// BH-030 fix: is a 13F-HR/A a full-book restatement (use it directly) or a
// partial amendment (merge onto the base book)? The SEC cover page's
// <amendmentType> is authoritative when readable; AMENDMENT_MIN_RATIO_FALLBACK
// is a last resort. Pure/exported for direct test coverage.
function _isFullBookAmendment(amendmentType, baseCount, amendCount) {
  if (amendmentType === 'RESTATEMENT') return true;
  if (amendmentType === 'NEW HOLDINGS') return false;
  return baseCount === 0 ? true : (amendCount / baseCount) >= AMENDMENT_MIN_RATIO_FALLBACK;
}

// Klassifiziert ein 13F-HR/A OHNE vergleichbares Original desselben Quartals.
// Zwei unabhaengige Gruende fuer "kein Vollbuch", ODER-verknuepft:
//   1. Die Cover-Page sagt nicht RESTATEMENT (NEW HOLDINGS oder unlesbar -> nicht Vollbuch).
//   2. Das Amendment hat GAR KEINE Positionen — dann ist es unabhaengig vom Cover-Page-Text
//      kein Vollbuch. Diese Regel stand vorher hier (positions.length === 0) und darf beim
//      Umbau auf die Cover-Page nicht verschwinden: ein leeres RESTATEMENT haette sonst
//      lowPositionAmendment:false getragen und ein Nullbuch als Vollbestand behauptet.
function _classifyNoBaseAmendment(amendmentType, positionCount) {
  const leer = !Number.isFinite(positionCount) ? false : positionCount === 0;
  return {
    amendmentType: amendmentType || null,
    lowPositionAmendment: amendmentType !== 'RESTATEMENT' || leer
  };
}

// Merge the rows of a PARTIAL 13F-HR/A onto the base book. Pure/exported for
// direct test coverage.
//
// AD-SK-001 fix (P0-Haertung 4, 2026-08-09): this used to be `merged.set(key, pos)`
// with key = cusip|titleOfClass|putCall — one row per key. But a 13F info table
// legitimately lists the SAME cusip several times (investmentDiscretion SOLE /
// DEFINED / OTHER, several other managers), so the base loop alone already collapsed
// real rows onto the last one; buildByTickerView() then summed a book that was
// silently short. The key still defines the REPLACEMENT unit (an amendment restates a
// security as a whole), but each key now holds a LIST, so no row is ever lost.
function _mergeAmendmentOntoBase(basePositions, amendPositions) {
  const _key = pos => [pos.cusip || '', pos.titleOfClass || '', pos.putCall || ''].join('|');
  const merged = new Map();   // key -> rows; Map keeps first-insertion order on re-set
  for (const pos of basePositions || []) {
    if (!merged.has(_key(pos))) merged.set(_key(pos), []);
    merged.get(_key(pos)).push(pos);
  }
  const restated = new Set();
  for (const pos of amendPositions || []) {
    const k = _key(pos);
    if (!restated.has(k)) { restated.add(k); merged.set(k, []); }  // amendment replaces the whole group
    merged.get(k).push(pos);
  }
  return [].concat(...merged.values());
}

// ─── Per-institution pull ───────────────────────────────────────────────
async function pullInstitution13f(cik, displayName, deps = {}) {
  const get = deps.httpGet || httpGet;
  const getInfoTableUrl = deps.findInfoTableUrl || findInfoTableUrl;
  const getAmendmentType = deps.fetchAmendmentType || _fetchAmendmentType;
  const pause = deps.sleep || sleep;
  const paddedCik = padCik(cik);
  const subRes = await get(SEC_SUBMISSIONS_URL(paddedCik));
  await pause(RATE_DELAY_MS);
  if (subRes.notFound) {
    return { positions: [], error: 'submissions-404' };
  }
  let subJson;
  try { subJson = JSON.parse(subRes.body); }
  catch (e) { return { positions: [], error: 'submissions-parse: ' + e.message }; }

  const name = _institutionName(subJson) || displayName || ('CIK ' + paddedCik);
  const all = _normalizeSubmissions(subJson);
  const f13s = all.filter(f => f.form === '13F-HR' || f.form === '13F-HR/A');
  if (f13s.length === 0) {
    return { positions: [], name, error: 'no-13f-hr-filings' };
  }

  const { reportPeriod, newest, baseFiling } = _selectPeriodFilings(f13s);

  // audit F-A-2026-06-22 (scope narrowed to one report period by BH-029):
  // prevents a partial 13F-HR/A restatement from replacing the full holdings
  // book. An amendment (13F-HR/A) is frequently filed AFTER the original
  // 13F-HR to correct or add a SINGLE position; its information_table can
  // legitimately contain only the changed rows. Picking it purely by latest
  // filingDate would silently drop most of the book.
  //
  // Strategy:
  //   - identify the newest ORIGINAL 13F-HR *for the target period* as the
  //     base (full book).
  //   - if the newest filing in the period is a /A, fetch BOTH the /A and
  //     the base. BH-030: ask the SEC cover page (primary_doc.xml) what kind
  //     of amendment this is — RESTATEMENT (full book) vs NEW HOLDINGS
  //     (additive/partial) — and fall back to the position-count ratio
  //     heuristic only when the cover page is unavailable/unparseable.
  //   - record amendmentOf + a low-position-count flag so downstream can audit.

  // Fetch helper: resolve + download + parse one filing's info table.
  async function _fetchPositions(filing) {
    const acc = (filing.accessionNumber || '').replace(/-/g, '');
    if (!acc) return { error: 'no-accession-number' };
    const url = await getInfoTableUrl(paddedCik, acc);
    if (!url) return { error: 'no-information-table-found' };
    let res;
    try { res = await get(url); }
    catch (e) { await pause(RATE_DELAY_MS); return { error: 'info-table-fetch: ' + e.message }; }
    await pause(RATE_DELAY_MS);
    if (res.notFound || !res.body) return { error: 'info-table-404' };
    const parsed = _parse13fXmlDetailed(res.body);
    return { positions: parsed.positions, truncated: parsed.truncated,
             blocksSeen: parsed.blocksSeen, positionsParsed: parsed.positionsParsed,
             infoTableUrl: url };
  }

  // Common case: newest filing (for the target period) is an original
  // 13F-HR (or there is no /A at all) — behave exactly as before, no extra
  // fetch.
  if (newest.form === '13F-HR') {
    const r = await _fetchPositions(newest);
    if (r.error) {
      return { positions: [], name, filingDate: newest.filingDate, reportPeriod,
               accessionNumber: newest.accessionNumber, error: r.error };
    }
    return {
      positions: r.positions,
      name,
      filingDate: newest.filingDate,
      reportPeriod,
      accessionNumber: newest.accessionNumber,
      infoTableUrl: r.infoTableUrl,
      form: newest.form,
      truncated: r.truncated || false,
      blocksSeen: r.blocksSeen,
      positionsParsed: r.positionsParsed
    };
  }

  // Newest filing (for the target period) is a 13F-HR/A amendment.
  const amend = await _fetchPositions(newest);
  if (amend.error) {
    return { positions: [], name, filingDate: newest.filingDate, reportPeriod,
             accessionNumber: newest.accessionNumber, form: newest.form, error: amend.error };
  }
  // No prior original 13F-HR for this SAME period to compare against —
  // accept the /A as-is but flag it.
  if (!baseFiling || baseFiling.accessionNumber === newest.accessionNumber) {
    const amendmentType = await getAmendmentType(paddedCik, newest);
    const classification = _classifyNoBaseAmendment(amendmentType, amend.positions.length);
    return {
      positions: amend.positions,
      name,
      filingDate: newest.filingDate,
      reportPeriod,
      accessionNumber: newest.accessionNumber,
      infoTableUrl: amend.infoTableUrl,
      form: newest.form,
      amendmentOf: null,
      amendmentType: classification.amendmentType,
      lowPositionAmendment: classification.lowPositionAmendment,
      truncated: amend.truncated || false,
      blocksSeen: amend.blocksSeen,
      positionsParsed: amend.positionsParsed
    };
  }

  const base = await _fetchPositions(baseFiling);
  if (base.error) {
    // Can't validate against the base — fall back to the /A but flag it.
    return {
      positions: amend.positions,
      name,
      filingDate: newest.filingDate,
      reportPeriod,
      accessionNumber: newest.accessionNumber,
      infoTableUrl: amend.infoTableUrl,
      form: newest.form,
      amendmentOf: baseFiling.accessionNumber,
      lowPositionAmendment: true,
      baseFetchError: base.error,
      truncated: amend.truncated || false,
      blocksSeen: amend.blocksSeen,
      positionsParsed: amend.positionsParsed
    };
  }

  const baseCount = base.positions.length;
  const amendCount = amend.positions.length;
  // BH-030 fix: SEC cover-page amendment type decides first; the position-
  // count ratio is used only when the cover page can't be read.
  const amendmentType = await getAmendmentType(paddedCik, newest);
  const ratioOk = _isFullBookAmendment(amendmentType, baseCount, amendCount);

  if (ratioOk) {
    // The /A is a full-book restatement — use it directly.
    return {
      positions: amend.positions,
      name,
      filingDate: newest.filingDate,
      reportPeriod,
      accessionNumber: newest.accessionNumber,
      infoTableUrl: amend.infoTableUrl,
      form: newest.form,
      amendmentOf: baseFiling.accessionNumber,
      amendmentType: amendmentType || null,
      lowPositionAmendment: false,
      truncated: amend.truncated || false,
      blocksSeen: amend.blocksSeen,
      positionsParsed: amend.positionsParsed
    };
  }

  // Partial restatement: merge the /A rows onto the base book so we don't drop
  // the rest of the holdings. Amendment rows win on identity (cusip|class|putCall).
  return {
    positions: _mergeAmendmentOntoBase(base.positions, amend.positions),
    name,
    filingDate: newest.filingDate,
    reportPeriod,
    accessionNumber: newest.accessionNumber,
    infoTableUrl: amend.infoTableUrl,
    form: newest.form,
    amendmentOf: baseFiling.accessionNumber,
    amendmentType: amendmentType || null,
    amendmentMerged: true,
    lowPositionAmendment: true,
    amendmentPositionCount: amendCount,
    basePositionCount: baseCount,
    // Truncation flag reflects either side hitting the cap.
    truncated: (amend.truncated || base.truncated) || false,
    blocksSeen: base.blocksSeen,
    positionsParsed: base.positionsParsed
  };
}

// ─── CLI parsing ────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    cikList: null,
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    out: DEFAULT_CACHE_PATH
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cik-list' && i + 1 < argv.length) {
      out.cikList = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (a.startsWith('--cik-list=')) {
      out.cikList = a.slice('--cik-list='.length).split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--max-age-days' && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) out.maxAgeDays = n;
    } else if (a.startsWith('--max-age-days=')) {
      const n = parseInt(a.slice('--max-age-days='.length), 10);
      if (Number.isFinite(n) && n > 0) out.maxAgeDays = n;
    } else if (a === '--out' && i + 1 < argv.length) {
      out.out = argv[++i];
    } else if (a.startsWith('--out=')) {
      out.out = a.slice('--out='.length);
    }
  }
  return out;
}

// BH-032 fix: the derived by-ticker view previously ALWAYS wrote to the
// hardcoded production path (BY_TICKER_PATH) regardless of --out, so an
// isolated smoke run (e.g. `--out=temp.json --cik-list=...` for a single
// institution) silently clobbered the real by-ticker file with just that
// smoke institution's data. Only the default cache path derives the default
// by-ticker path; any custom --out derives its own sibling file instead.
function deriveByTickerPath(outPath) {
  if (outPath === DEFAULT_CACHE_PATH) return BY_TICKER_PATH;
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, path.extname(outPath));
  return path.join(dir, base + '.by-ticker.json');
}

// ─── Derived: ticker-by-CUSIP best-effort index ─────────────────────────
// CUSIPs aren't in the SEC ticker→CIK map. As a best-effort fallback we
// group positions by issuer-name (uppercased, trimmed) AND by CUSIP. The
// resulting by-ticker file is keyed by CUSIP with an issuer-name field so
// downstream methods can join on either.
//
// Tag 226a-1: previously the issuer→ticker join used exact uppercased
// strings, which only matched 6/26 issuers in Berkshire's 13F because of:
//   - trailing punctuation: SEC "Apple Inc."   vs 13F "APPLE INC"
//   - state suffixes:       SEC "BANK OF AMERICA CORP /DE/" vs 13F "BANK AMERICA CORP"
//   - 13F abbreviations:    SEC "OCCIDENTAL PETROLEUM CORP" vs 13F "OCCIDENTAL PETE CORP"
//   - punctuation:          SEC "Macy's, Inc." vs 13F "MACYS INC"
//
// The fix is a `_normName` canonicalizer applied to BOTH sides of the join:
//   - uppercase + trim, strip CDATA, collapse spaces
//   - drop trailing /XX/ state suffixes (DE, NEW, NV, CA, …)
//   - strip punctuation (.,'-/&) but keep word boundaries
//   - drop common corporate suffix tokens (INC, CORP, CO, LTD, PLC, COMPANY,
//     HOLDINGS, GROUP, CLASS A/B/C, COM, MTN, BE)
//   - expand 13F abbreviations (FINL→FINANCIAL, PETE→PETROLEUM, INTL→
//     INTERNATIONAL, MGMT→MANAGEMENT, COS→COMPANIES, SVCS→SERVICES, etc.)
//   - drop the leading filler word "OF" (BANK OF AMERICA → BANK AMERICA)
function _normName(name) {
  if (!name) return '';
  let s = String(name).toUpperCase().trim();
  // Strip CDATA wrappers if any leaked through.
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  // Strip SEC state-suffix markers, both bounded "/DE/" form and the
  // suffix form "INC/CA". Done before any other punctuation handling.
  s = s.replace(/\/[A-Z]{2,5}\/?/g, ' ');
  // Replace ampersand-as-AND BEFORE stripping punctuation (so we don't
  // create "AMP" tokens via the entity).
  s = s.replace(/&AMP;/g, '&').replace(/&/g, ' AND ');
  // Delete apostrophes/quotes WITHOUT spacing (MACY'S → MACYS, not MACY S).
  s = s.replace(/[.''"""`]/g, '');
  // Replace remaining structural punctuation with spaces (LOUISIANA-PACIFIC
  // → LOUISIANA PACIFIC; commas; slashes; parens).
  s = s.replace(/[,\-\/\(\)]/g, ' ');
  // Collapse multiple whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  // Expand common 13F-style abbreviations. PAC→PACIFIC and FIN→FINANCIAL
  // are intentional generalizations; risk of overstrip is low because the
  // SEC primary name almost always uses the full form.
  const ABBREV = {
    'FINL': 'FINANCIAL',
    'FIN':  'FINANCIAL',
    'PETE': 'PETROLEUM',
    'PETROL': 'PETROLEUM',
    'PAC':  'PACIFIC',
    'INTL': 'INTERNATIONAL',
    'INTERNATL': 'INTERNATIONAL',
    'MGMT': 'MANAGEMENT',
    'COMM': 'COMMUNICATIONS',
    'COMMS': 'COMMUNICATIONS',
    'COS': 'COMPANIES',
    'SVCS': 'SERVICES',
    'SVC': 'SERVICES',
    'TECH': 'TECHNOLOGY',
    'TECHS': 'TECHNOLOGIES',
    'INDS': 'INDUSTRIES',
    'IND': 'INDUSTRIAL',
    'PHARMA': 'PHARMACEUTICAL',
    'PHARMS': 'PHARMACEUTICALS',
    'ASSOC': 'ASSOCIATES',
    'BANCORP': 'BANCORPORATION',
    'BCORP': 'BANCORPORATION',
    'HLDGS': 'HOLDINGS',
    'HLDG': 'HOLDINGS',
    'NATL': 'NATIONAL',
    'SIRIUSXM': 'SIRIUS XM',
    'AMER': 'AMERICAN',
    'PETROCHEM': 'PETROCHEMICALS'
  };
  // Drop noise/suffix tokens that vary between sources but carry no
  // identity signal. INCLUDES the lonely "IN" left behind when SEC
  // truncates a 13F long name like "JEFFERIES FINANCIAL GROUP INC" →
  // "JEFFERIES FINANCIAL GROUP IN" at the 28-char field limit.
  const STRIP = new Set([
    'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY',
    'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'LLP',
    'HOLDINGS', 'HOLDING', 'HLDGS', 'GROUP', 'GROUPS',
    'CLASS', 'CL', 'COM',
    // Common 13F filler tokens
    'MTN', 'BE', 'NEW', 'OLD',
    // SEC 13F truncation residual ("INC" cut to "IN")
    'IN',
    // Country/state boilerplate that appears on some foreign-issuer 13F rows
    'SWITZ', 'BERMUDA', 'CAYMAN', 'DE', 'CA', 'NV', 'NY',
    // Filler glue
    'OF', 'THE', 'AND'
  ]);
  const tokens = s.split(' ').map(t => ABBREV[t] || t).filter(t => t && !STRIP.has(t));
  return tokens.join(' ');
}

function buildByTickerView(cache) {
  const byCusip = {};
  const byIssuerName = {};
  const byTicker = {};
  // Try to resolve issuer name → ticker via best-effort substring match
  // against the SEC ticker→CIK map's `name` field. Loaded if available;
  // missing map → byTicker stays empty (still publish byCusip / byIssuer).
  const map = readJsonSafe(TICKER_CIK_MAP_PATH);
  // Tag 226a-1 / BH-031 fix: build canonicalized name→ticker map. When two
  // SEC entries collide on the same canonical form (e.g. share-class
  // duplicates GOOG / GOOGL — this repo's ticker-CIK map carries an
  // IDENTICAL name "Alphabet Inc." for both, so there is no CUSIP/share-class
  // security master here to pick the right one), a shortest-ticker-wins
  // guess would silently misattribute one class's holdings to the other.
  // Instead: mark the name a collision (nameToTicker[norm] = null) and DON'T
  // resolve it to any ticker — report it via `collisions` so it's auditable
  // instead of silently guessed.
  const nameToTicker = {};
  const exactToTicker = {};
  const collisions = {}; // normName -> [ticker, ticker, ...]
  if (map && map.byTicker) {
    for (const [ticker, info] of Object.entries(map.byTicker)) {
      if (!info || !info.name) continue;
      const exact = info.name.toUpperCase().trim();
      if (!(exact in exactToTicker)) exactToTicker[exact] = ticker;
      else if (exactToTicker[exact] !== ticker) exactToTicker[exact] = null; // collision, same treatment

      const norm = _normName(info.name);
      if (!norm) continue;
      if (!(norm in nameToTicker)) {
        nameToTicker[norm] = ticker;
      } else if (nameToTicker[norm] === null) {
        if (collisions[norm].indexOf(ticker) === -1) collisions[norm].push(ticker);
      } else if (nameToTicker[norm] !== ticker) {
        collisions[norm] = [nameToTicker[norm], ticker];
        nameToTicker[norm] = null;
      }
    }
  }

  for (const [instCik, entry] of Object.entries(cache.byInstitution || {})) {
    if (!entry || !Array.isArray(entry.positions)) continue;
    for (const p of entry.positions) {
      const cusip = (p.cusip || '').toUpperCase().trim();
      const issuer = (p.nameOfIssuer || '').toUpperCase().trim();
      // audit F-A-2026-06-22: prevents the thousands-vs-dollars unit-confusion
      // failure mode that understated totalValueUSD 1000x. The SEC 13F `value`
      // field is reported in THOUSANDS of USD; emit the unit explicitly at the
      // data boundary so no downstream reader can re-introduce the ambiguity.
      // `value` (legacy, thousands) is retained for backward-compat with the
      // existing consumer that still reads it; new consumers should read
      // `valueUSD` (whole dollars) which is the unambiguous field.
      const valueThousandsUSD = p.value;
      const valueUSD = Number.isFinite(p.value) ? p.value * 1000 : null;
      const holding = {
        institutionCik: instCik,
        institutionName: entry.name || null,
        filingDate: entry.filingDate || null,
        // BH-034 fix: provenance. A soft-errored institution's LAST
        // successful positions are deliberately carried over in the cache
        // (see main()'s error branch) so the by-ticker view doesn't go dark
        // on a transient failure — but that means these holdings can be
        // stale. Carry the error/timestamps through so a consumer can tell
        // fresh holdings from a stale error-preserved book.
        fetchedAt: entry.fetchedAt || null,
        error: entry.error || null,
        failedAt: entry.failedAt || null,
        value: p.value,              // DEPRECATED alias of valueThousandsUSD (thousands USD)
        valueThousandsUSD,           // explicit unit: thousands of USD (raw SEC schema)
        valueUSD,                    // derived whole-dollar value (valueThousandsUSD * 1000)
        shares: p.sshPrnamt,
        shareType: p.sshPrnamtType,
        putCall: p.putCall
      };
      if (cusip) {
        (byCusip[cusip] = byCusip[cusip] || {
          cusip, nameOfIssuer: p.nameOfIssuer, holders: []
        }).holders.push(holding);
      }
      if (issuer) {
        (byIssuerName[issuer] = byIssuerName[issuer] || {
          nameOfIssuer: p.nameOfIssuer, holders: []
        }).holders.push(holding);
        // Tag 226a-1 / BH-031 fix: canonicalized join, with legacy
        // exact-uppercase match as a defense-in-depth fallback for any
        // oddball name the normalizer might overstrip. A `null` map value
        // means a known collision (>1 distinct ticker) — skip publishing
        // rather than guess.
        let ticker = nameToTicker[_normName(issuer)];
        if (ticker === undefined) ticker = exactToTicker[issuer];
        if (ticker) {
          (byTicker[ticker] = byTicker[ticker] || {
            ticker, nameOfIssuer: p.nameOfIssuer, holders: []
          }).holders.push(holding);
        }
      }
    }
  }
  return { byCusip, byIssuerName, byTicker, collisions };
}

// BH-033 fix: is the store currently believable "institutional coverage" or
// too sparse/stale to trust? Pure function (no I/O) so it's hermetically
// testable. Below RESEARCH_ACTIVE_MIN_INSTITUTIONS live institutions, the
// output is stamped 'research-inactive' rather than silently looking like a
// real cross-section — the puller is manual-only (see file header), so a
// long-stale, single-digit-coverage store won't self-heal without a run.
function computeResearchStatus(byInstitution, now = Date.now(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const entries = Object.values(byInstitution || {});
  const activeInstitutionCount = entries.filter(e =>
    e && !e.error && Array.isArray(e.positions) && e.positions.length > 0
  ).length;
  const freshInstitutionCount = entries.filter(e => {
    if (!e || e.error || !Array.isArray(e.positions) || e.positions.length === 0) return false;
    if (!e.fetchedAt) return true; // Legacy-Caches: unbekannt, bis ein Pull den Zeitanker nachtraegt.
    const fetchedAt = Date.parse(e.fetchedAt);
    return Number.isFinite(fetchedAt) && now - fetchedAt <= maxAgeDays * 86400000;
  }).length;
  const enough = activeInstitutionCount >= RESEARCH_ACTIVE_MIN_INSTITUTIONS;
  const status = !enough ? 'research-inactive'
    : freshInstitutionCount >= RESEARCH_ACTIVE_MIN_INSTITUTIONS ? 'active' : 'stale';
  return { status, activeInstitutionCount, freshInstitutionCount };
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  ensureDir(EXTERNAL_DIR);
  const args = parseArgs(process.argv);
  const maxAgeMs = args.maxAgeDays * 86400000;

  // Resolve target institution list.
  let targets;
  if (args.cikList && args.cikList.length > 0) {
    targets = args.cikList.map(c => ({ cik: padCik(c), name: null }));
    console.log('  [input] using --cik-list (' + targets.length + ' institutions)');
  } else {
    // De-dupe on padded CIK; entries marked "(placeholder)" in name are
    // still queried — SEC will simply 404 on bad CIKs and we'll log
    // failedAt and move on.
    const seen = new Set();
    targets = [];
    for (const inst of BOOTSTRAP_INSTITUTIONS) {
      const p = padCik(inst.cik);
      if (seen.has(p)) continue;
      seen.add(p);
      targets.push({ cik: p, name: inst.name });
    }
    console.log('  [input] using bootstrap list (' + targets.length + ' unique CIKs)');
  }

  // Load existing cache so per-institution TTL skips work.
  const existing = readJsonSafe(args.out) || {};
  const byInstitution = (existing && existing.byInstitution && typeof existing.byInstitution === 'object')
    ? existing.byInstitution : {};

  let fetched = 0, skippedFresh = 0, errors = 0, totalPositions = 0;
  for (const t of targets) {
    const cik = t.cik;
    const prev = byInstitution[cik];
    // audit F-A-2026-06-22: freshness gate keys on fetchedAt for SUCCESSFUL
    // pulls only. A soft-errored entry (see below) carries `nextRetryAt`
    // instead of a fresh fetchedAt, so it is retried on its own short cadence
    // rather than being treated fresh for the full 100-day TTL.
    if (prev && prev.fetchedAt && !prev.error &&
        (Date.now() - new Date(prev.fetchedAt).getTime()) < maxAgeMs) {
      skippedFresh++;
      totalPositions += Array.isArray(prev.positions) ? prev.positions.length : 0;
      continue;
    }
    // Soft-errored entry not yet due for retry → skip without re-hitting SEC.
    if (prev && prev.error && prev.nextRetryAt &&
        Date.now() < new Date(prev.nextRetryAt).getTime()) {
      skippedFresh++;
      // Preserve any prior SUCCESSFUL positions in the running total.
      totalPositions += Array.isArray(prev.positions) ? prev.positions.length : 0;
      continue;
    }
    try {
      const r = await pullInstitution13f(cik, t.name);
      if (r.error) {
        // audit F-A-2026-06-22: prevents soft-error (return-not-throw) pulls
        // being cached fresh and starving the by-ticker view for a quarter.
        // pullInstitution13f RETURNS (does not throw) on the common failure
        // cases (submissions-404, no-13f-hr-filings, parse-fail, info-table
        // 404/fetch). The catch block below is therefore never reached for
        // them; without this branch the entry would be written with a fresh
        // fetchedAt and skipped by the freshness gate for the full 100-day
        // TTL. Instead: stamp failedAt (NOT fetchedAt), set a retry TTL, and
        // PRESERVE any prior successful positions/fetchedAt/filing metadata.
        errors++;
        // A genuine non-13F CIK (no 13F-HR filings ever, or submissions 404)
        // is effectively permanent — back off harder so we don't re-hit SEC
        // every run — but still far short of the 100-day fresh TTL so a CIK
        // that later starts filing is picked up. Everything else is transient.
        const permanent = (r.error === 'no-13f-hr-filings' || r.error === 'submissions-404');
        const retryDays = permanent ? PERMANENT_ERROR_RETRY_DAYS : ERROR_RETRY_DAYS;
        const nowIso = new Date().toISOString();
        byInstitution[cik] = Object.assign({}, prev || {}, {
          cik,
          name: r.name || (prev && prev.name) || t.name || null,
          // Keep the last SUCCESSFUL data so the by-ticker view doesn't go
          // dark for this institution on a transient soft error.
          fetchedAt: (prev && prev.fetchedAt) || null,
          filingDate: (prev && prev.filingDate) || null,
          accessionNumber: (prev && prev.accessionNumber) || null,
          form: (prev && prev.form) || null,
          infoTableUrl: (prev && prev.infoTableUrl) || null,
          positions: (prev && Array.isArray(prev.positions)) ? prev.positions : [],
          error: r.error,
          failedAt: nowIso,
          nextRetryAt: new Date(Date.now() + retryDays * 86400000).toISOString(),
          errorPermanent: permanent
        });
        totalPositions += (byInstitution[cik].positions || []).length;
        console.warn('  [' + cik + '] ' + (r.name || t.name || '?') +
          ' SOFT-ERR=' + r.error + ' (failedAt; retry in ' + retryDays + 'd' +
          (permanent ? ', permanent' : '') + '; prior positions preserved=' +
          (byInstitution[cik].positions || []).length + ')');
      } else {
        const reportPeriod = r.reportPeriod || r.filingDate || null;
        // BH-028 fix: keep a per-reportPeriod history alongside the flat
        // top-level fields (which still mirror the LATEST period only, for
        // backward compat with any reader written before this fix — e.g.
        // tests/13f-test.js's synthetic fixtures). Previously
        // byInstitution[cik] was replaced wholesale on every successful
        // refresh, so the prior quarter's book was gone the moment a new one
        // was fetched — impossible to reconcile with the header's own claim
        // of "accumulation across quarters".
        const prevQuarters = (prev && prev.quarters && typeof prev.quarters === 'object') ? prev.quarters : {};
        const quarters = Object.assign({}, prevQuarters);
        if (reportPeriod) {
          quarters[reportPeriod] = {
            filingDate: r.filingDate || null,
            accessionNumber: r.accessionNumber || null,
            form: r.form || null,
            positions: r.positions || [],
            truncated: r.truncated || false,
            amendmentOf: r.amendmentOf || null,
            amendmentType: r.amendmentType || null,
            amendmentMerged: r.amendmentMerged || false,
            lowPositionAmendment: r.lowPositionAmendment || false
          };
        }
        byInstitution[cik] = {
          cik,
          name: r.name || t.name || null,
          fetchedAt: new Date().toISOString(),
          filingDate: r.filingDate || null,
          reportPeriod,
          accessionNumber: r.accessionNumber || null,
          form: r.form || null,
          infoTableUrl: r.infoTableUrl || null,
          positions: r.positions || [],
          error: null,
          // audit F-A-2026-06-22: persist truncation + amendment provenance so
          // silent MAX_POSITIONS_PER_FILING truncation and partial 13F-HR/A
          // restatements are recorded in the cache and auditable downstream.
          truncated: r.truncated || false,
          blocksSeen: (r.blocksSeen != null) ? r.blocksSeen : null,
          positionsParsed: (r.positionsParsed != null) ? r.positionsParsed : null,
          amendmentOf: r.amendmentOf || null,
          amendmentType: r.amendmentType || null,
          amendmentMerged: r.amendmentMerged || false,
          lowPositionAmendment: r.lowPositionAmendment || false,
          quarters // BH-028: reportPeriod-keyed history
        };
        fetched++;
        totalPositions += (r.positions || []).length;
        console.log('  [' + cik + '] ' + (r.name || t.name || '?') +
          ' filing=' + (r.filingDate || '?') +
          ' positions=' + (r.positions || []).length +
          (r.truncated ? ' TRUNCATED' : '') +
          (r.amendmentMerged ? ' AMEND-MERGED(' + (r.amendmentOf || '?') + ')' :
            (r.amendmentOf ? ' AMEND(' + r.amendmentOf + ')' : '')));
      }
    } catch (e) {
      // audit/fix: 429 IP-block backoff. On a rate-limit (429) or 503, back off
      // 30 s and retry this institution WITHOUT incrementing the abort/error
      // counter and WITHOUT stamping a fresh failedAt/nextRetryAt on the cache
      // entry — the institution simply isn't processed this pass and is retried
      // next run. Counting a 429 as an error would burn the abort budget (>25) on
      // a transient throttle and normal cadence would hammer SEC into an IP block.
      if (e && (e.statusCode === 429 || e.statusCode === 503)) {
        console.warn('  [' + cik + '] rate-limited (HTTP ' + e.statusCode +
          ') — backing off ' + (RATE_LIMIT_BACKOFF_MS / 1000) + 's');
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      errors++;
      // Tag 211j errored-pull pattern: write failedAt (NOT fetchedAt) so
      // the freshness gate retries this institution on the next run.
      // Preserve any prior successful pull's data.
      // audit F-A-2026-06-22: also set `error` + `nextRetryAt` so the updated
      // freshness gate (which skips errored entries only until nextRetryAt)
      // treats a thrown error identically to a soft-error — a transient throw
      // (timeout, 403, network) retries on the short cadence, never the
      // 100-day fresh TTL.
      byInstitution[cik] = Object.assign({}, prev || {}, {
        cik,
        error: 'thrown: ' + e.message,
        failedAt: new Date().toISOString(),
        nextRetryAt: new Date(Date.now() + ERROR_RETRY_DAYS * 86400000).toISOString(),
        errorPermanent: false,
        lastError: e.message
      });
      console.warn('  [' + cik + '] ERROR: ' + e.message);
      if (errors > 25) {
        console.error('  too many errors (>25) — aborting early to be polite to SEC');
        break;
      }
    }
    // BH-033: recompute coverage status each write — cheap (~40 entries) and
    // keeps the on-disk status honest even if a run is Ctrl-C'd mid-loop.
    const runStatus = computeResearchStatus(byInstitution, Date.now(), args.maxAgeDays);
    // Re-write after every institution so a Ctrl-C leaves a valid cache.
    writeFileAtomic(args.out, JSON.stringify({
      updatedAt: new Date().toISOString(),
      userAgentSource: 'process.env.SEC_CONTACT',
      maxAgeDays: args.maxAgeDays,
      // BH-033: sichtbare Abdeckungs-Kennzeichnung statt stillschweigend
      // suggerierter institutioneller Vollabdeckung.
      status: runStatus.status,
      activeInstitutionCount: runStatus.activeInstitutionCount,
      // Ein Zaehler ohne Leser ist keine Kennzeichnung: freshInstitutionCount entscheidet
      // ueber active/stale und muss deshalb neben dem Status im Artefakt stehen.
      freshInstitutionCount: runStatus.freshInstitutionCount,
      bootstrapInstitutionCount: BOOTSTRAP_INSTITUTIONS.length,
      byInstitution
    }, null, 2));
  }

  // Final derived by-ticker view.
  // BH-032 fix: derive from --out instead of the hardcoded production path.
  const byTickerPath = deriveByTickerPath(args.out);
  const finalStatus = computeResearchStatus(byInstitution, Date.now(), args.maxAgeDays);
  const cache = { byInstitution };
  const derived = buildByTickerView(cache);
  writeFileAtomic(byTickerPath, JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: 'derived from ' + args.out,
    // BH-033: same coverage-honesty stamp as the main cache.
    status: finalStatus.status,
    activeInstitutionCount: finalStatus.activeInstitutionCount,
    freshInstitutionCount: finalStatus.freshInstitutionCount,
    bootstrapInstitutionCount: BOOTSTRAP_INSTITUTIONS.length,
    cusipCount: Object.keys(derived.byCusip).length,
    issuerNameCount: Object.keys(derived.byIssuerName).length,
    tickerCount: Object.keys(derived.byTicker).length,
    // BH-031: issuer names that canonicalize to >1 distinct ticker (no
    // CUSIP-level security master exists here to pick the right share
    // class) — reported instead of silently guessed.
    collisionCount: Object.keys(derived.collisions).length,
    byCusip: derived.byCusip,
    byIssuerName: derived.byIssuerName,
    byTicker: derived.byTicker,
    collisions: derived.collisions
  }, null, 2));

  const uniqueTickers = Object.keys(derived.byTicker).length;
  const uniqueCusips = Object.keys(derived.byCusip).length;
  console.log('');
  console.log('Done. fetched=' + fetched + ' skipped(fresh)=' + skippedFresh +
    ' errors=' + errors + ' totalPositions=' + totalPositions);
  console.log('  uniqueCUSIPs=' + uniqueCusips + ' resolvedTickers=' + uniqueTickers +
    ' collisions=' + Object.keys(derived.collisions).length);
  console.log('  coverage status=' + finalStatus.status +
    ' (active=' + finalStatus.activeInstitutionCount + '/' + BOOTSTRAP_INSTITUTIONS.length +
    ', fresh<=' + args.maxAgeDays + 'd=' + finalStatus.freshInstitutionCount + ')');
  console.log('Cache: ' + args.out);
  console.log('By-ticker view: ' + byTickerPath);

  // audit/fix: 403 silent exit-0. If NOTHING succeeded but errors occurred
  // (fetched === 0 && errors > 0) the run was a total failure — typically a
  // systemic 403/UA/IP-block outage rather than scattered per-institution
  // hiccups. Exit non-zero so CI surfaces it instead of a green run over an
  // empty cache. (skippedFresh-only runs fetch 0 with 0 errors → stay exit 0.)
  if (fetched === 0 && errors > 0) {
    console.error('TOTAL FAILURE: 0 institutions fetched with ' + errors +
      ' error(s) — likely a systemic SEC outage / 403 / IP block. Exiting 1.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  parse13fXml,
  padCik,
  buildByTickerView,
  parseArgs,
  computeResearchStatus,  // BH-033: exposed for test coverage
  deriveByTickerPath,     // BH-032: exposed for test coverage
  _internals: {
    httpGet,
    _normalizeSubmissions,
    findInfoTableUrl,
    pullInstitution13f,
    _selectPeriodFilings,   // BH-029: exposed for test coverage
    _isFullBookAmendment,   // BH-030: exposed for test coverage
    _classifyNoBaseAmendment,
    _mergeAmendmentOntoBase, // AD-SK-001: exposed for test coverage
    _fetchAmendmentType,    // BH-030: exposed for test coverage (network; not called in hermetic tests)
    BOOTSTRAP_INSTITUTIONS,
    _normName,  // Tag 226a-1: exposed for test coverage
    // audit F-A-2026-06-22: exposed so truncation telemetry is testable.
    _parse13fXmlDetailed
  },
  _secRateLimit: SEC_RATE_LIMIT
};
