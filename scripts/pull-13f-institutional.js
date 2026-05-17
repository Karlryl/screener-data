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
const USER_AGENT = 'Karl Viehrig screener-data karl_viehrig@web.de';

// 125 ms ≈ 8 req/s (SEC limit: 10/s/IP).
const RATE_DELAY_MS = 125;

// 13F-HR filings are quarterly (45-day deadline post-quarter-end). A 100-day
// TTL means we refresh roughly once per quarter, which matches the data's
// natural cadence.
const DEFAULT_MAX_AGE_DAYS = 100;

// Per-institution position-count sanity ceiling. BlackRock / Vanguard 13F
// filings can list 5,000+ positions; we cap parsing at 20,000 to keep cache
// size bounded and reject obviously-corrupt filings without OOM risk.
const MAX_POSITIONS_PER_FILING = 20000;

// ─── Bootstrap institution list ─────────────────────────────────────────
// Hardcoded list of well-known institutional managers. CIKs are SEC-padded
// 10-digit strings. This list is the "starting set"; expand by editing
// here or by passing --cik-list on the CLI.
//
// Verified via https://efts.sec.gov/LATEST/search-index?forms=13F-HR&q=<name>
// where possible; CIKs marked PLACEHOLDER need verification before the data
// is trusted downstream.
const BOOTSTRAP_INSTITUTIONS = [
  { cik: '0001067983', name: 'Berkshire Hathaway Inc' },
  { cik: '0001364742', name: 'BlackRock Inc' },
  { cik: '0000102909', name: 'Vanguard Group Inc' },
  { cik: '0000093751', name: 'State Street Corp' },
  { cik: '0000895421', name: 'Morgan Stanley' },
  { cik: '0000886982', name: 'Goldman Sachs Group Inc' },
  { cik: '0000019617', name: 'JPMorgan Chase & Co' },
  { cik: '0000070858', name: 'Bank of America Corp' },
  { cik: '0001029160', name: 'Citigroup Inc (placeholder)' },
  { cik: '0000831001', name: 'Citigroup Inc' },
  { cik: '0001037389', name: 'Renaissance Technologies LLC' },
  { cik: '0001350694', name: 'Bridgewater Associates LP' },
  { cik: '0001423053', name: 'Citadel Advisors LLC' },
  { cik: '0001029160', name: 'Two Sigma Investments LP (placeholder)' },
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
  { cik: '0001037389', name: 'D. E. Shaw & Co LP (placeholder)' },
  { cik: '0001009207', name: 'D. E. Shaw & Co LP' },
  { cik: '0001656456', name: 'AQR Capital Management LLC (placeholder)' },
  { cik: '0001167557', name: 'AQR Capital Management LLC' },
  { cik: '0000898437', name: 'Wellington Management Group LLP' },
  { cik: '0000315066', name: 'Fidelity Management & Research (FMR LLC)' },
  { cik: '0000200217', name: 'T. Rowe Price Group Inc' },
  { cik: '0000354204', name: 'Capital Research Global Investors' },
  { cik: '0000034088', name: 'ExxonMobil (placeholder — not an institution)' },
  { cik: '0001029160', name: 'PRIMECAP Management Co (placeholder)' },
  { cik: '0000810893', name: 'PRIMECAP Management Co' },
  { cik: '0000884144', name: 'Sequoia Capital (placeholder)' },
  { cik: '0001112520', name: 'Sequoia Fund Inc' },
  { cik: '0001364750', name: 'Susquehanna International Group LLP' },
  { cik: '0001135730', name: 'Millennium Management LLC (placeholder)' },
  { cik: '0001273087', name: 'Millennium Management LLC' },
  { cik: '0001553733', name: 'Point72 Asset Management LP' },
  { cik: '0001603466', name: 'Element Capital Management LLC' },
  { cik: '0001602119', name: 'Balyasny Asset Management LP' },
  { cik: '0001364742', name: 'Norges Bank (placeholder — Norway sovereign)' },
  { cik: '0001262039', name: 'Dodge & Cox' },
  { cik: '0000093750', name: 'Franklin Resources Inc' },
  { cik: '0000832988', name: 'Invesco Ltd' },
  { cik: '0000895421', name: 'UBS Group AG (placeholder — overlaps Morgan Stanley row)' }
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
      if (res.statusCode === 403) return reject(new Error('HTTP 403 (likely rate-limited or bad UA): ' + url));
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
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

function parse13fXml(xml) {
  if (!xml || typeof xml !== 'string') return [];
  const blocks = _extractAll(xml, 'infoTable');
  const positions = [];
  for (const block of blocks) {
    if (positions.length >= MAX_POSITIONS_PER_FILING) break;
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
  return positions;
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

// ─── Per-institution pull ───────────────────────────────────────────────
async function pullInstitution13f(cik, displayName) {
  const paddedCik = padCik(cik);
  const subRes = await httpGet(SEC_SUBMISSIONS_URL(paddedCik));
  await sleep(RATE_DELAY_MS);
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
  // Pick the latest by filingDate (lexicographic on ISO YYYY-MM-DD is fine).
  f13s.sort((a, b) => (b.filingDate || '').localeCompare(a.filingDate || ''));
  const latest = f13s[0];
  const accNoDash = (latest.accessionNumber || '').replace(/-/g, '');
  if (!accNoDash) {
    return { positions: [], name, error: 'no-accession-number' };
  }

  const infoTableUrl = await findInfoTableUrl(paddedCik, accNoDash);
  if (!infoTableUrl) {
    return {
      positions: [],
      name,
      filingDate: latest.filingDate,
      accessionNumber: latest.accessionNumber,
      error: 'no-information-table-found'
    };
  }
  let xmlRes;
  try { xmlRes = await httpGet(infoTableUrl); }
  catch (e) {
    await sleep(RATE_DELAY_MS);
    return {
      positions: [],
      name,
      filingDate: latest.filingDate,
      accessionNumber: latest.accessionNumber,
      error: 'info-table-fetch: ' + e.message
    };
  }
  await sleep(RATE_DELAY_MS);
  if (xmlRes.notFound || !xmlRes.body) {
    return {
      positions: [],
      name,
      filingDate: latest.filingDate,
      accessionNumber: latest.accessionNumber,
      error: 'info-table-404'
    };
  }
  const positions = parse13fXml(xmlRes.body);
  return {
    positions,
    name,
    filingDate: latest.filingDate,
    accessionNumber: latest.accessionNumber,
    infoTableUrl,
    form: latest.form
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
  // Tag 226a-1: build canonicalized name→ticker map. When two SEC entries
  // collide on the same canonical form (e.g. share-class duplicates GOOG /
  // GOOGL both canonicalize to "ALPHABET"), prefer the SHORTEST ticker —
  // typically the primary listing/most-liquid class. Berkshire's 13F lists
  // ALPHABET once without share-class so we want to attribute that holding
  // to a single ticker rather than randomly pick one.
  // Also keep a legacy exact-uppercase map as a fallback — defense in depth
  // for any oddball name the normalizer might overstrip.
  const nameToTicker = {};
  const exactToTicker = {};
  if (map && map.byTicker) {
    for (const [ticker, info] of Object.entries(map.byTicker)) {
      if (info && info.name) {
        const exact = info.name.toUpperCase().trim();
        exactToTicker[exact] = ticker;
        const norm = _normName(info.name);
        if (!norm) continue;
        const prev = nameToTicker[norm];
        if (!prev || ticker.length < prev.length) {
          nameToTicker[norm] = ticker;
        }
      }
    }
  }

  for (const [instCik, entry] of Object.entries(cache.byInstitution || {})) {
    if (!entry || !Array.isArray(entry.positions)) continue;
    for (const p of entry.positions) {
      const cusip = (p.cusip || '').toUpperCase().trim();
      const issuer = (p.nameOfIssuer || '').toUpperCase().trim();
      const holding = {
        institutionCik: instCik,
        institutionName: entry.name || null,
        filingDate: entry.filingDate || null,
        value: p.value,
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
        // Tag 226a-1: canonicalized join, with legacy exact-uppercase
        // match as a defense-in-depth fallback for any oddball name the
        // normalizer might overstrip.
        let ticker = nameToTicker[_normName(issuer)];
        if (!ticker) ticker = exactToTicker[issuer];
        if (ticker) {
          (byTicker[ticker] = byTicker[ticker] || {
            ticker, nameOfIssuer: p.nameOfIssuer, holders: []
          }).holders.push(holding);
        }
      }
    }
  }
  return { byCusip, byIssuerName, byTicker };
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
    if (prev && prev.fetchedAt &&
        (Date.now() - new Date(prev.fetchedAt).getTime()) < maxAgeMs) {
      skippedFresh++;
      totalPositions += Array.isArray(prev.positions) ? prev.positions.length : 0;
      continue;
    }
    try {
      const r = await pullInstitution13f(cik, t.name);
      byInstitution[cik] = {
        cik,
        name: r.name || t.name || null,
        fetchedAt: new Date().toISOString(),
        filingDate: r.filingDate || null,
        accessionNumber: r.accessionNumber || null,
        form: r.form || null,
        infoTableUrl: r.infoTableUrl || null,
        positions: r.positions || [],
        error: r.error || null
      };
      fetched++;
      totalPositions += (r.positions || []).length;
      console.log('  [' + cik + '] ' + (r.name || t.name || '?') +
        ' filing=' + (r.filingDate || '?') +
        ' positions=' + (r.positions || []).length +
        (r.error ? ' ERR=' + r.error : ''));
    } catch (e) {
      errors++;
      // Tag 211j errored-pull pattern: write failedAt (NOT fetchedAt) so
      // the freshness gate retries this institution on the next run.
      // Preserve any prior successful pull's data.
      byInstitution[cik] = Object.assign({}, prev || {}, {
        cik,
        failedAt: new Date().toISOString(),
        lastError: e.message
      });
      console.warn('  [' + cik + '] ERROR: ' + e.message);
      if (errors > 25) {
        console.error('  too many errors (>25) — aborting early to be polite to SEC');
        break;
      }
    }
    // Re-write after every institution so a Ctrl-C leaves a valid cache.
    writeFileAtomic(args.out, JSON.stringify({
      updatedAt: new Date().toISOString(),
      userAgent: USER_AGENT,
      maxAgeDays: args.maxAgeDays,
      byInstitution
    }, null, 2));
  }

  // Final derived by-ticker view.
  const cache = { byInstitution };
  const derived = buildByTickerView(cache);
  writeFileAtomic(BY_TICKER_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: 'derived from sec-13f-cache.json',
    cusipCount: Object.keys(derived.byCusip).length,
    issuerNameCount: Object.keys(derived.byIssuerName).length,
    tickerCount: Object.keys(derived.byTicker).length,
    byCusip: derived.byCusip,
    byIssuerName: derived.byIssuerName,
    byTicker: derived.byTicker
  }, null, 2));

  const uniqueTickers = Object.keys(derived.byTicker).length;
  const uniqueCusips = Object.keys(derived.byCusip).length;
  console.log('');
  console.log('Done. fetched=' + fetched + ' skipped(fresh)=' + skippedFresh +
    ' errors=' + errors + ' totalPositions=' + totalPositions);
  console.log('  uniqueCUSIPs=' + uniqueCusips + ' resolvedTickers=' + uniqueTickers);
  console.log('Cache: ' + args.out);
  console.log('By-ticker view: ' + BY_TICKER_PATH);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  parse13fXml,
  padCik,
  buildByTickerView,
  parseArgs,
  _internals: {
    httpGet,
    _normalizeSubmissions,
    findInfoTableUrl,
    pullInstitution13f,
    BOOTSTRAP_INSTITUTIONS,
    _normName  // Tag 226a-1: exposed for test coverage
  }
};
