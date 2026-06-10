#!/usr/bin/env node
/**
 * Tag 133k: SEC XBRL Fundamentals Overlay (Pull-Phase)
 * ====================================================
 * Holt für jeden in `discovery/sec-tickers.js` bekannten US-Ticker die
 * `companyfacts/CIK{cik}.json` Datei der SEC und cached sie lokal. Diese
 * Files enthalten audited, point-in-time-correct annual & quarterly Werte
 * für ~80% der relevanten Fundamentals — komplementär zu Yahoo.
 *
 * Diese PR macht NUR den Pull. Das Merge-In-Snapshots passiert in einem
 * Folge-PR, sobald wir 1-2 Wochen SEC-Daten gesammelt haben und die Konzepte
 * (us-gaap:Revenues etc.) gegen Yahoo-Werte validiert sind.
 *
 * Cache:
 *   external-data/sec-xbrl/<CIK>.json — git-ignored, runner-local
 *   external-data/sec-xbrl/_manifest.json — committed
 *
 * Rate-Limit: SEC erlaubt 10 req/sec. Wir nutzen 8 req/sec (125ms zwischen Calls)
 *             plus If-Modified-Since-Headers wo möglich.
 *
 * Run: node pull-sec-xbrl.js [--max N] [--concurrency K]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const { fetchSecTickers } = require('./discovery/sec-tickers.js');
// Tag 189: F-SM-023 — atomic manifest writes.
const { writeFileAtomic } = require('./lib/atomic-write.js');

// Cache location is overridable via SEC_XBRL_CACHE_DIR so a full local pull
// (~15GB across ~10k tickers) can be written OUTSIDE a cloud-synced folder.
// The repo lives under OneDrive; the in-repo default would otherwise upload
// the whole companyfacts corpus to the cloud. CI leaves the env unset and so
// keeps the original in-repo path (only _manifest.json is committed anyway).
const CACHE_DIR = process.env.SEC_XBRL_CACHE_DIR || path.join(__dirname, 'external-data', 'sec-xbrl');
const MANIFEST_PATH = path.join(CACHE_DIR, '_manifest.json');
// SEC EDGAR Terms of Use REQUIRE a User-Agent carrying a real contact. A
// contactless UA (the old 'screener-data/1.0 (github.com/...)') is silently
// served HTTP 403 by data.sec.gov — empirically confirmed: contactless → 403,
// with-contact → 200. This is the SAME defect Tag 211j fixed in
// pull-insider-form4.js and pull-13f-institutional.js; pull-sec-xbrl.js was
// missed and so the monthly XBRL pull returned err=51/pulled=0 on every run
// (the 51-error abort gate at the pull loop tripped on 51 consecutive 403s).
// Keep this string identical to the other two SEC scripts.
const USER_AGENT = 'Karl Viehrig screener-data karl_viehrig@web.de';
const RATE_DELAY_MS = 125;       // 8 req/sec (under SEC 10/sec limit)
const RATE_LIMIT_BACKOFF_MS = 30000; // F-006: pause after an HTTP 429 before continuing
const STALE_DAYS = 90;           // re-pull after 90 days (typical 10-Q cycle)

function parseArgs(argv) {
  const args = { max: Infinity, concurrency: 1 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--max' && argv[i+1]) args.max = parseInt(argv[++i], 10);
    else if (argv[i] === '--concurrency' && argv[i+1]) args.concurrency = Math.max(1, parseInt(argv[++i], 10));
  }
  return args;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// F-SC-015 (Tag 181): cap redirect-follow to 5 hops. Previously this recursed
// without a counter — a misconfigured SEC URL or infinite redirect chain
// would blow the stack and crash the pull. Also drops the body of the redirect
// response (was leaked when SEC sends large 301 pages).
function get(url, ifModifiedSince, _redirectDepth) {
  const depth = _redirectDepth | 0;
  if (depth > 5) return Promise.reject(new Error('too many redirects (>5) for ' + url));
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': USER_AGENT, 'Accept': 'application/json' };
    if (ifModifiedSince) headers['If-Modified-Since'] = ifModifiedSince;
    const req = https.get(url, { headers }, res => {
      if (res.statusCode === 304) return resolve({ notModified: true });
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();  // drain the body so the socket can be reused
        const nextUrl = res.headers.location;
        if (!nextUrl) return reject(new Error('redirect without Location header'));
        return get(nextUrl, ifModifiedSince, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode === 404) return resolve({ notFound: true });
      if (res.statusCode !== 200) {
        // F-006 (audit 2026-06-08): carry the status code so the pull loop can
        // distinguish a transient 429 rate-limit from real errors.
        const err = new Error('HTTP ' + res.statusCode);
        err.statusCode = res.statusCode;
        return reject(err);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        lastModified: res.headers['last-modified'] || null
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const manifest = readJson(MANIFEST_PATH) || { entries: {} };

  console.log('Fetching SEC ticker list...');
  const tickers = await fetchSecTickers();
  if (tickers.size === 0) {
    console.error('No SEC tickers loaded — aborting.');
    process.exit(1);
  }
  console.log('  ' + tickers.size + ' US tickers known');

  const today = new Date().toISOString().slice(0, 10);
  const staleCutoff = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - STALE_DAYS);
    return d.toISOString();
  })();

  let pulled = 0, skipped304 = 0, skippedFresh = 0, notFound = 0, errors = 0, rateLimited = 0;
  const entries = Object.values(Object.fromEntries(tickers));
  const todo = entries.slice(0, args.max);

  for (const t of todo) {
    if (!t.cik) continue;
    const filePath = path.join(CACHE_DIR, t.cik + '.json');
    const prior = manifest.entries[t.cik];
    if (prior && prior.fetchedAt && prior.fetchedAt > staleCutoff && fs.existsSync(filePath)) {
      skippedFresh++;
      continue;
    }
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${t.cik}.json`;
    try {
      const res = await get(url, prior && prior.lastModified);
      if (res.notModified) {
        manifest.entries[t.cik] = Object.assign({}, prior, { fetchedAt: new Date().toISOString() });
        skipped304++;
      } else if (res.notFound) {
        manifest.entries[t.cik] = { ticker: t.ticker, fetchedAt: new Date().toISOString(), notFound: true };
        notFound++;
      } else {
        writeFileAtomic(filePath, res.body);
        manifest.entries[t.cik] = {
          ticker: t.ticker,
          fetchedAt: new Date().toISOString(),
          lastModified: res.lastModified,
          bytes: Buffer.byteLength(res.body, 'utf8')
        };
        pulled++;
      }
    } catch (e) {
      // F-006 (audit 2026-06-08): a 429 rate-limit burst used to burn the 50-error
      // abort budget — one burst meant pulled=0 for the whole monthly run. 429s now
      // back off and do NOT count toward the abort gate; fetchedAt is deliberately
      // NOT refreshed so the next run retries the CIK. A separate generous cap
      // still aborts if SEC keeps 429ing the entire run (politeness).
      if (e && e.statusCode === 429) {
        rateLimited++;
        console.warn(`  429 rate-limited on CIK${t.cik} — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s (${rateLimited} so far)`);
        manifest.entries[t.cik] = Object.assign({}, prior, { lastError: 'HTTP 429 (rate-limited, will retry next run)' });
        await sleep(RATE_LIMIT_BACKOFF_MS);
        if (rateLimited > 200) {
          console.error('Persistent 429s (>200) — aborting run, SEC is throttling us.');
          break;
        }
        continue;
      }
      errors++;
      manifest.entries[t.cik] = Object.assign({}, prior, { fetchedAt: new Date().toISOString(), lastError: e.message });
      if (errors > 50) {
        console.error('Too many errors (>50) — aborting to be polite to SEC.');
        break;
      }
    }
    if ((pulled + skipped304) % 100 === 0 && (pulled + skipped304) > 0) {
      console.log(`  progress: pulled=${pulled} 304=${skipped304} fresh=${skippedFresh} 404=${notFound} err=${errors}`);
      // F-SM-023 (Tag 189): atomic — every 100-success flush, and final.
      writeFileAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    }
    await sleep(RATE_DELAY_MS);
  }

  manifest.lastRun = today;
  manifest.summary = { pulled, skipped304, skippedFresh, notFound, errors, rateLimited, totalKnown: tickers.size };
  writeFileAtomic(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log('Done. pulled=' + pulled + ' 304=' + skipped304 + ' fresh=' + skippedFresh + ' 404=' + notFound + ' err=' + errors + ' 429=' + rateLimited);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { main };
