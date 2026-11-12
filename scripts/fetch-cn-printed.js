'use strict';

// Independent SHADOW pass. Failure cannot prevent the CN/TW/BR passes from writing.
// No caller in the production pipeline; run separately, never as its prerequisite.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const S = require('../lib/exchange-quarter-store');
const { writeFileAtomic } = require('../lib/atomic-write');
const P = require('./cn-printed-parser');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_STORE = path.join(ROOT, 'external-data/exchange-quarters/cn-printed.json');
const PDFTOTEXT = 'C:/Program Files/Git/mingw64/bin/pdftotext.exe';
const SEARCH = 'http://www.cninfo.com.cn/new/information/topSearch/query';
const ANNOUNCEMENTS = 'http://www.cninfo.com.cn/new/hisAnnouncement/query';
const A_SHARE = /^(?:00\d{4}|30\d{4})\.SZ$|^6\d{5}\.SS$/;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const dateValid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const emptyStore = () => ({ schemaVersion: 1, market: 'CN-PRINTED', currency: 'CNY', shadow: true,
  about: 'Nur Schatten. Q3-Berichte von CNINFO;营业收入 gegen OPERATE_INCOME. Keine Quelle fuer Scoring oder Boards.', sources: {}, companies: {} });

function loadPrinted(file) {
  if (!fs.existsSync(file)) return emptyStore();
  const s = readJson(file);
  if (s.schemaVersion !== 1 || s.market !== 'CN-PRINTED' || s.shadow !== true || !s.sources || !s.companies) throw new Error('cn-printed-schema-invalid');
  return s;
}

function createClient({ fetchImpl = global.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  let ended = null, calls = 0;
  async function request(url, form) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (ended !== null) await sleep(Math.max(0, 1500 - (now() - ended)));
      let response;
      try {
        calls++;
        response = await fetchImpl(url, { method: form ? 'POST' : 'GET', redirect: 'error',
          headers: { 'User-Agent': 'Mozilla/5.0 (public financial report research)',
            ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}) },
          ...(form ? { body: new URLSearchParams(form).toString() } : {}), signal: AbortSignal.timeout(60000) });
        if (!response.ok) {
          const e = new Error('cninfo-http-' + response.status);
          e.transient = [408, 429, 500, 502, 503, 504].includes(response.status);
          throw e;
        }
        const data = form ? await response.json() : Buffer.from(await response.arrayBuffer());
        ended = now();
        return data;
      } catch (e) {
        ended = now();
        const transient = e.transient || ['TimeoutError', 'AbortError'].includes(e.name) ||
          (e instanceof TypeError && /fetch failed|network/i.test(e.message));
        if (!transient || attempt === 2) throw e;
      }
    }
  }
  return { request, calls: () => calls };
}

function announcementMeta(a, ticker, year, asOf) {
  const title = String(a.announcementTitle || '').replace(/<[^>]*>/g, '');
  if (!new RegExp(year + '年?(?:第三季度|三季度|3季度)报告').test(title) || /英文|摘要|取消|公告/.test(title)) return null;
  if (a.secCode !== ticker.slice(0, 6)) return null;
  const adjunct = String(a.adjunctUrl || '');
  const m = /^finalpage\/(\d{4}-\d{2}-\d{2})\/(\d+)\.pdf$/i.exec(adjunct);
  if (!m || String(a.announcementId) !== m[2] || !dateValid(m[1])) return null;
  const noticeDate = typeof a.announcementTime === 'number' && finiteTime(a.announcementTime)
    ? new Date(a.announcementTime + 8 * 3600000).toISOString().slice(0, 10) : m[1];
  if (noticeDate > asOf || noticeDate < year + '-10-01') return null;
  return { announcementId: m[2], url: 'https://static.cninfo.com.cn/' + adjunct, noticeDate, title,
    noticeDateEvidence: typeof a.announcementTime === 'number' ? 'cninfo-announcement-time-beijing' : 'cninfo-adjunct-url-day' };
}
const finiteTime = n => Number.isFinite(n) && Math.abs(n) < 8e15;

async function findAnnouncement(client, ticker, year, asOf) {
  const code = ticker.slice(0, 6);
  const hits = await client.request(SEARCH, { keyWord: code, maxNum: '10' });
  if (!Array.isArray(hits)) throw new Error('cninfo-search-shape');
  const exact = hits.filter(h => h.code === code && typeof h.orgId === 'string' && /^[a-zA-Z0-9_-]+$/.test(h.orgId));
  if (exact.length !== 1) throw new Error('cninfo-org-missing-or-ambiguous');
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const q = await client.request(ANNOUNCEMENTS, { stock: code + ',' + exact[0].orgId,
      column: ticker.endsWith('.SZ') ? 'szse' : 'sse', tabName: 'fulltext', pageSize: '30', pageNum: String(page),
      category: 'category_sjdbg_szsh', seDate: year + '-10-01~' + asOf, isHLtitle: 'true' });
    if (!q || !Array.isArray(q.announcements)) throw new Error('cninfo-announcement-shape');
    all.push(...q.announcements.map(a => announcementMeta(a, ticker, year, asOf)).filter(Boolean));
    if (!q.hasMore) break;
    if (page === 5) throw new Error('cninfo-announcement-page-cap');
  }
  all.sort((a, b) => b.noticeDate.localeCompare(a.noticeDate) || b.announcementId.localeCompare(a.announcementId));
  if (!all.length) throw new Error('q3-report-not-found');
  return all[0];
}

function pdfToText(pdf, txt, binary = PDFTOTEXT) {
  execFileSync(binary, ['-layout', '-f', '1', '-l', '4', pdf, txt], { windowsHide: true, timeout: 60000, stdio: 'pipe' });
  return fs.readFileSync(txt, 'utf8');
}

async function cachedText(client, meta, cacheDir, convert = pdfToText) {
  if (!/^\d+$/.test(meta.announcementId) || !new RegExp('^https://static\\.cninfo\\.com\\.cn/finalpage/\\d{4}-\\d{2}-\\d{2}/' + meta.announcementId + '\\.pdf$', 'i').test(meta.url)) throw new Error('pdf-metadata-invalid');
  fs.mkdirSync(cacheDir, { recursive: true });
  const pdf = path.join(cacheDir, meta.announcementId + '.pdf');
  const txt = path.join(cacheDir, meta.announcementId + '.txt');
  let bytes = fs.existsSync(pdf) ? fs.readFileSync(pdf) : null;
  if (!bytes) {
    bytes = await client.request(meta.url);
    if (!Buffer.isBuffer(bytes) || bytes.length > 40e6 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('pdf-invalid');
    fs.writeFileSync(pdf, bytes, { flag: 'wx' });
  }
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('cached-pdf-invalid');
  const text = fs.existsSync(txt) ? fs.readFileSync(txt, 'utf8') : convert(pdf, txt);
  return { text, pdfSha256: hash(bytes), textSha256: hash(text) };
}

function sampleEntries(dir, year, asOf) {
  const out = fs.existsSync(path.join(dir, 'out/result.json')) ? path.join(dir, 'out') : dir;
  return readJson(path.join(out, 'result.json')).map(r => {
    const m = /^https:\/\/static\.cninfo\.com\.cn\/(finalpage\/(\d{4}-\d{2}-\d{2})\/(\d+)\.PDF)$/i.exec(r.url || '');
    if (!m || !A_SHARE.test(r.ticker)) throw new Error('sample-metadata-invalid');
    const meta = announcementMeta({ announcementTitle: r.title, secCode: r.ticker.slice(0, 6),
      adjunctUrl: m[1], announcementId: m[3] }, r.ticker, year, asOf);
    if (!meta) throw new Error('sample-q3-metadata-invalid');
    return { ticker: r.ticker, meta, txt: path.join(out, 'pdf', r.ticker.replace('.SS', '.SH') + '.txt'),
      pdf: path.join(out, 'pdf', r.ticker.replace('.SS', '.SH') + '.pdf') };
  });
}

function alternatingQueue(tickers) {
  const sz = tickers.filter(t => t.endsWith('.SZ')).sort(), ss = tickers.filter(t => t.endsWith('.SS')).sort();
  const out = [];
  for (let i = 0; i < Math.max(sz.length, ss.length); i++) {
    if (sz[i]) out.push(sz[i]); if (ss[i]) out.push(ss[i]);
  }
  return out;
}

async function main(options = {}) {
  const cap = options.cap ?? 300, year = options.year ?? 2026;
  const fetchedAt = (options.now ? options.now() : new Date()).toISOString();
  const asOf = options.asOf || fetchedAt.slice(0, 10);
  if (!Number.isInteger(cap) || cap < 1 || cap > 300) throw new Error('cap-must-be-1-to-300');
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !dateValid(asOf) || asOf < year + '-10-01') throw new Error('invalid-year-or-as-of');
  const cnFile = options.cnStore || path.join(ROOT, 'external-data/exchange-quarters/cn.json');
  const file = path.resolve(options.store || DEFAULT_STORE);
  if (path.basename(file) !== 'cn-printed.json' || path.resolve(cnFile) === file) throw new Error('shadow-output-path-required');
  const cn = readJson(cnFile), prev = loadPrinted(file), next = JSON.parse(JSON.stringify(prev));
  if (cn.market !== 'CN' || cn.currency !== 'CNY' || cn.unit !== 1 || !cn.companies || typeof cn.companies !== 'object') throw new Error('cn-anchor-store-invalid');
  const src = 'cn-printed-' + fetchedAt.replace(/[^\dTZ]/g, '') + '-' + crypto.randomBytes(4).toString('hex');
  const client = options.client || createClient();
  const samples = options.sampleDir ? sampleEntries(options.sampleDir, year, asOf) : null;
  const sampleMap = new Map((samples || []).map(r => [r.ticker, r]));
  const input = options.tickers || (samples ? samples.map(s => s.ticker) : Object.keys(cn.companies || {}).filter(t => A_SHARE.test(t)));
  if (input.some(t => !A_SHARE.test(t))) throw new Error('non-a-share-ticker');
  // Prefer tickers not attempted yet, then the oldest attempt. A second capped run progresses.
  const last = t => Object.values(prev.sources).filter(s => s.year === year && s.read?.includes(t)).map(s => s.fetchedAt).sort().at(-1) || '';
  const queue = alternatingQueue([...new Set(input)]).sort((a, b) => last(a).localeCompare(last(b))).slice(0, cap);
  if (!queue.length) throw new Error('no-a-shares-in-input');
  const run = { fetchedAt, asOf, year, mode: samples ? 'offline-sample' : 'live', parserVersion: P.VERSION,
    cnStoreSha256: hash(fs.readFileSync(cnFile)), cap, read: [], parsed: 0, unparsed: 0, errors: [], calls: 0 };
  for (const ticker of queue) {
    let meta = null, parsed, evidence = {};
    try {
      const anchor = P.eastmoneyAnchor(cn, ticker, year);
      if (samples) {
        const s = sampleMap.get(ticker);
        if (!s) throw new Error('sample-ticker-missing');
        meta = s.meta;
        const text = fs.readFileSync(s.txt, 'utf8');
        evidence = { textSha256: hash(text), pdfSha256: hash(fs.readFileSync(s.pdf)) };
        parsed = P.parseText(text, anchor, { ticker, year });
      } else {
        meta = await findAnnouncement(client, ticker, year, asOf);
        const fetched = await cachedText(client, meta, options.cacheDir || path.join(ROOT, 'outputs/cn-printed-cache'), options.convert);
        evidence = { pdfSha256: fetched.pdfSha256, textSha256: fetched.textSha256 };
        parsed = P.parseText(fetched.text, anchor, { ticker, year });
      }
    } catch (e) {
      // Never put paths, response bodies, or credentials into a public store/log.
      const code = /^[a-z][a-z0-9-]+$/.test(e.message) ? e.message : 'fetch-or-extraction-failed';
      parsed = { parseStatus: 'unparsed', reason: code, parserVersion: P.VERSION };
      run.errors.push({ ticker, reason: code });
    }
    const observation = { periodEnd: year + '-09-30', announcementId: meta?.announcementId || null,
      url: meta?.url || null, noticeDate: meta?.noticeDate || null, title: meta?.title || null,
      noticeDateEvidence: meta?.noticeDateEvidence || null,
      ...evidence, ...parsed };
    const company = next.companies[ticker] || (next.companies[ticker] = { reports: {} });
    const key = meta?.announcementId || 'gap-' + year + 'Q3';
    const list = company.reports[key] || (company.reports[key] = []);
    S.mergeObservation(list, observation, { src, fetchedAt, updateDate: meta?.noticeDate || null });
    run.read.push(ticker); run[parsed.parseStatus === 'parsed' ? 'parsed' : 'unparsed']++;
  }
  run.calls = client.calls();
  next.sources[src] = run;
  S.assertAppendOnly(prev, next);
  // Refuse concurrent changes, instead of replacing a history written while this pass ran.
  if (JSON.stringify(loadPrinted(file)) !== JSON.stringify(prev)) throw new Error('shadow-store-changed-during-run');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, S.serialiseStore(next));
  const rate = queue.length ? run.parsed / queue.length : 0;
  return { src, ...run, parseRate: rate, gate300: run.mode === 'live' && queue.length === 300 ? rate >= 0.9 : null,
    exitCode: run.errors.length || (queue.length === 300 && rate < 0.9) ? 1 : 0 };
}

function cliArgs(argv) {
  const opts = {};
  const names = { cap: 'cap', year: 'year', 'as-of': 'asOf', store: 'store', 'cn-store': 'cnStore',
    'cache-dir': 'cacheDir', 'sample-dir': 'sampleDir', tickers: 'tickers' };
  for (const arg of argv) {
    const m = /^--([^=]+)=(.+)$/.exec(arg);
    if (!m || !names[m[1]]) throw new Error('unknown-or-empty-flag');
    opts[names[m[1]]] = ['cap', 'year'].includes(m[1]) ? Number(m[2]) : m[1] === 'tickers' ? m[2].split(',') : m[2];
  }
  return opts;
}

if (require.main === module) main(cliArgs(process.argv.slice(2))).then(r => {
  console.log(JSON.stringify(r)); process.exitCode = r.exitCode;
}).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main, createClient, announcementMeta, findAnnouncement, cachedText, pdfToText, cliArgs, A_SHARE };
