'use strict';
// tests/fetch-exchange-quarters.test.js — standalone runner (node tests/fetch-exchange-quarters.test.js, exit 0/1).
// The fetch script against fake sources in a temp directory: no live network, no write to the live store.
// China rows and MOPS answers carry real figures from the G2 probes of 02.10.2026.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

https.get = () => { throw new Error('live network access in a test'); };
https.request = () => { throw new Error('live network access in a test'); };

const LIVE_DIR = path.join(__dirname, '..', 'external-data', 'exchange-quarters');
const { main, taiwanQueue } = require('../scripts/fetch-exchange-quarters.js');
const S = require('../lib/exchange-quarter-store.js');

const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent');
const liveBefore = { cn: sha(path.join(LIVE_DIR, 'cn.json')), tw: sha(path.join(LIVE_DIR, 'tw.json')) };
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-'));
  assert.notEqual(path.resolve(d), path.resolve(LIVE_DIR), 'test dir must not be the live store');
  return d;
}

// ── fake Eastmoney ────────────────────────────────────────────────────────────
const G = (sec, org, period, type, total, operate, notice, update) => ({ SECUCODE: sec, ORG_TYPE: org,
  REPORT_DATE: period + ' 00:00:00', REPORT_TYPE: type, NOTICE_DATE: notice + ' 00:00:00', UPDATE_DATE: update + ' 00:00:00',
  CURRENCY: 'CNY', TOTAL_OPERATE_INCOME: total, OPERATE_INCOME: operate });
function cnRows() {
  return {
    'RPT_F10_FINANCE_GINCOME': {
      '2026-06-30': [G('000958.SZ', '通用', '2026-06-30', '中报', 4832132828.91, 4832132828.91, '2026-08-28', '2026-08-28'),
        G('600064.SH', '通用', '2026-06-30', '中报', 1408208446.73, 1406734729.77, '2026-08-29', '2026-08-29'),
        G('000001.SZ', '银行', '2026-06-30', '中报', 69385000000, 69385000000, '2026-08-23', '2026-08-23'),
        G('999999.SZ', '通用', '2026-06-30', '中报', 5, 5, '2026-08-01', '2026-08-01')],
      '2025-09-30': [G('000958.SZ', '通用', '2025-09-30', '三季报', 3650029509.49, 3650029509.49, '2025-10-29', '2025-10-29'),
        G('600064.SH', '通用', '2025-09-30', '三季报', 2399700641.02, 2399700641.02, '2025-10-31', '2025-10-31'),
        G('000686.SZ', '证券', '2025-09-30', '三季报', 1, 1, '2025-10-29', '2025-10-29')],
      '2025-06-30': [G('000958.SZ', '通用', '2025-06-30', '中报', 6155289807.22, 6155289807.22, '2025-08-22', '2026-08-28')],
    },
    'RPT_F10_FINANCE_SINCOME': {
      '2025-09-30': [{ SECUCODE: '000686.SZ', ORG_TYPE: '证券', REPORT_DATE: '2025-09-30 00:00:00', REPORT_TYPE: '三季报',
        NOTICE_DATE: '2025-10-29 00:00:00', UPDATE_DATE: '2025-10-29 00:00:00', CURRENCY: 'CNY', OPERATE_INCOME: 3861241657.41 }],
    },
  };
}
function eastmoney(rows, hooks = {}) {
  const log = [];
  const fn = async (url, opts) => {
    const u = new URL(url);
    const report = u.searchParams.get('reportName');
    const period = /REPORT_DATE='([\d-]+)'/.exec(u.searchParams.get('filter'))[1];
    log.push({ url, opts, report, period });
    if (hooks.before) { const r = hooks.before(report, period, log.length); if (r !== undefined) return r; }
    const cols = u.searchParams.get('columns').split(',');
    const data = (rows[report] && rows[report][period] || []).map((z) => Object.fromEntries(cols.map((c) => [c, z[c] === undefined ? null : z[c]])));
    if (!data.length) return { success: false, code: 9201, message: '返回数据为空' };
    return { success: true, code: 0, result: { count: data.length, pages: 1, data } };
  };
  fn.log = log;
  return fn;
}
const TICKERS = ['000958.SZ', '600064.SS', '000001.SZ', '000686.SZ', '200002.SZ', '6446.TW', '2548.TW', '6023.TWO', '1312A.TW', '2330.TW'];
const NOW = (iso) => () => new Date(iso);
const quiet = () => {};

// ── fake MOPS ─────────────────────────────────────────────────────────────────
const TITLES = {
  3: (y) => ['會計項目', y + '年第3季', (y - 1) + '年第3季', y + '年01月01日至' + y + '年09月30日', (y - 1) + '年01月01日至' + (y - 1) + '年09月30日'],
  2: (y) => ['會計項目', y + '年第2季', (y - 1) + '年第2季', y + '年01月01日至' + y + '年06月30日', (y - 1) + '年01月01日至' + (y - 1) + '年06月30日'],
  1: (y) => ['會計項目', y + '年01月01日至' + y + '年03月31日', y + '年第1季', (y - 1) + '年01月01日至' + (y - 1) + '年03月31日', (y - 1) + '年第1季'],
  4: (y) => ['會計項目', y + '年度', (y - 1) + '年度'],
};
const ROWS = {
  '6446|114|3': ['營業收入合計', '3,893,772', '100.00', '2,713,359', '100.00', '10,753,539', '100.00', '6,673,280', '100.00'],
  '6446|114|4': ['營業收入合計', '15,634,777', '100.00', '9,734,814', '100.00'],
  '6446|115|1': ['營業收入合計', '5,121,378', '100.00', '5,121,378', '100.00', '3,257,306', '100.00', '3,257,306', '100.00'],
  '6446|115|2': ['營業收入合計', '6,855,431', '100.00', '3,602,461', '100.00', '11,976,809', '100.00', '6,859,767', '100.00'],
  '2548|114|3': ['營業收入合計', '2,835,266', '100.00', '5,423,461', '100.00', '4,863,270', '100.00', '7,166,529', '100.00'],
  '2548|114|4': ['營業收入合計', '18,238,702', '100.00', '7,212,415', '100.00'],
  '2548|115|1': ['營業收入合計', '4,206,418', '100.00', '4,206,418', '100.00', '11,454', '100.00', '11,454', '100.00'],
  '2548|115|2': ['營業收入合計', '1,501,063', '100.00', '2,016,550', '100.00', '5,707,481', '100.00', '2,028,004', '100.00'],
  '6023|115|2': ['收益合計', '1,275,065', '100.00', '906,377', '100.00', '2,478,953', '100.00', '1,799,750', '100.00'],
};
function okAnswer(b, row, over = {}) {
  return { code: 200, message: '查詢成功', result: { reportType: '合併', year: b.year, season: b.season,
    titles: TITLES[b.season](Number(b.year)).map((m) => ({ main: m, sub: [] })),
    reportList: [row, ['營業成本合計', '1', '0', '1', '0', '1', '0', '1', '0'].slice(0, row.length)],
    urlList: [{ url: 'https://mopsov.twse.com.tw/never-called' }], ...over } };
}
// MOPS answer for a preferred share, measured live 02.10.2026 for 1312A and 2002A (115Q2).
const BAD_ID = { code: 500, message: '公司代號格式錯誤', result: null };
function mops(hooks = {}) {
  const log = [];
  const fn = async (url, opts) => {
    const b = JSON.parse(opts.body);
    log.push({ url, opts, b });
    if (hooks.before) { const r = hooks.before(b, log.length); if (r !== undefined) return r; }
    if (b.companyId === '1312A') return BAD_ID;
    if (b.companyId === '2330') throw new Error('timeout nach 45000ms');   // a transient failure
    const row = ROWS[b.companyId + '|' + b.year + '|' + b.season];
    if (!row) return { code: 406, message: '查無相符資料', result: null };
    return okAnswer(b, row);
  };
  fn.log = log;
  return fn;
}
const PRIORITY = new Map([['2548.TW', { rank: 5, gap: true }], ['6446.TW', { rank: 140, gap: true }], ['6023.TWO', { rank: 30, gap: true }]]);

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
const read = (d, m) => JSON.parse(fs.readFileSync(path.join(d, m + '.json'), 'utf8'));

(async () => {
  // ── China ──────────────────────────────────────────────────────────────────
  await test('CN: whole-market pages filtered to the watchlist; general and broker tables; banks counted, not stored', async () => {
    const dir = tmpDir();
    const em = eastmoney(cnRows());
    const r = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: em, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    const s = read(dir, 'cn');
    assert.deepEqual(Object.keys(s.companies).sort(), ['000686.SZ', '000958.SZ', '600064.SS']);
    const o = s.companies['000958.SZ'].ytd['2025-09-30'][0];
    assert.equal(o.total, 3650029509.49);
    assert.equal(o.reportType, '三季报');
    assert.equal(o.noticeDate, '2025-10-29');
    assert.deepEqual(o.confirmedBy, [{ src: 'cn-20261002T070000Z', fetchedAt: '2026-10-02T07:00:00.000Z', updateDate: '2025-10-29' }]);
    assert.equal(s.companies['000958.SZ'].ytd['2025-06-30'][0].confirmedBy[0].updateDate, '2026-08-28');
    assert.equal(s.companies['600064.SS'].secucode, '600064.SH');
    assert.equal(s.companies['600064.SS'].ytd['2026-06-30'][0].operate, 1406734729.77);
    const b = s.companies['000686.SZ'].ytd['2025-09-30'];
    assert.equal(b.length, 1, 'the broker comes from SINCOME only, its GINCOME row is not stored');
    assert.equal(b[0].table, 'SINCOME');
    assert.equal(b[0].operate, 3861241657.41);
    assert.equal('total' in b[0], false);
    assert.equal(r.results[0].otherOrgTypes['GINCOME:银行'], 1);
    assert.equal(r.results[0].otherOrgTypes['GINCOME:证券'], 1);
    assert.equal(em.log.length, 16, '8 periods x 2 tables, one page each');
    assert.ok(em.log.some((x) => x.period === '2024-12-31'), 'the FY end before the oldest quarter is fetched');
    assert.ok(em.log.every((x) => x.opts.pauseMs >= 1500 && x.opts.headers['User-Agent'] === 'screener-data exchange-quarters fetch'));
    assert.ok(em.log.every((x) => /columns=SECUCODE,ORG_TYPE,REPORT_DATE/.test(x.url) && !/columns=ALL/.test(x.url)));
    assert.match(s.about, /build-cnannual\.js lines 19-21/);
  });

  await test('CN: a re-fetch with identical numbers only confirms; a new UPDATE_DATE adds one confirmation; a changed number appends', async () => {
    const dir = tmpDir();
    await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    const before = read(dir, 'cn');
    const r2 = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-16T07:00:00Z'), log: quiet });
    assert.equal(r2.exitCode, 0);
    const s2 = read(dir, 'cn');
    const o2 = s2.companies['000958.SZ'].ytd['2025-09-30'];
    assert.equal(o2.length, 1);
    assert.equal(o2[0].confirmedBy.length, 1, 'same UPDATE_DATE: no extra confirmation');
    assert.equal(S.lastConfirmedAt(s2, '000958.SZ', '2025-09-30'), '2026-10-16T07:00:00.000Z', 'the run log records the re-reading');
    assert.equal(Object.keys(s2.sources['cn-20261016T070000Z'].absent).length, 0);
    assert.equal(r2.results[0].confirmed, 6, '000958 x3, 600064 x2, 000686 x1');
    S.assertAppendOnly(before, s2);
    const rows = cnRows();
    rows.RPT_F10_FINANCE_GINCOME['2025-09-30'][0].UPDATE_DATE = '2026-10-29 00:00:00';
    rows.RPT_F10_FINANCE_GINCOME['2025-09-30'][1].TOTAL_OPERATE_INCOME = 2399700000;
    await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(rows), now: NOW('2026-10-30T07:00:00Z'), log: quiet });
    const s3 = read(dir, 'cn');
    assert.deepEqual(s3.companies['000958.SZ'].ytd['2025-09-30'][0].confirmedBy.map((c) => c.updateDate), ['2025-10-29', '2026-10-29']);
    const p = s3.companies['600064.SS'].ytd['2025-09-30'];
    assert.equal(p.length, 2, 'restatement signal: the changed number is a second observation');
    assert.equal(p[0].total, 2399700641.02);
    assert.equal(p[1].total, 2399700000);
    assert.equal(Object.keys(s3.sources).length, 3);
  });

  await test('CN: a company missing from a later fetch keeps its stored data', async () => {
    const dir = tmpDir();
    await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    const rows = cnRows();
    rows.RPT_F10_FINANCE_GINCOME['2025-09-30'] = rows.RPT_F10_FINANCE_GINCOME['2025-09-30'].filter((z) => z.SECUCODE !== '000958.SZ');
    const r = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(rows), now: NOW('2026-10-16T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0);
    const s = read(dir, 'cn');
    assert.equal(s.companies['000958.SZ'].ytd['2025-09-30'][0].total, 3650029509.49);
    assert.deepEqual(s.sources['cn-20261016T070000Z'].absent, { '2025-09-30': ['000958.SZ'] });
    assert.equal(S.lastConfirmedAt(s, '000958.SZ', '2025-09-30'), '2026-10-02T07:00:00.000Z', 'not confirmed by the run that missed it');
  });

  const downCases = {
    'HTTP 500 after retries': () => { throw new Error('https://x -> nach 4 Versuchen aufgegeben: HTTP 500'); },
    'timeout': () => { throw new Error('timeout nach 45000ms'); },
    'success:false code 9501': () => ({ success: false, code: 9501, message: 'report config does not exist' }),
    'truncated JSON': () => { throw new Error('https://x -> Antwort ist kein JSON (720590 Bytes)'); },
    'count mismatch': () => ({ success: true, code: 0, result: { count: 3, pages: 1, data: [G('000958.SZ', '通用', '2026-06-30', '中报', 1, 1, '2026-08-28', '2026-08-28')] } }),
    'unknown REPORT_TYPE': () => ({ success: true, code: 0, result: { count: 1, pages: 1, data: [G('000958.SZ', '通用', '2026-06-30', '半年报', 1, 1, '2026-08-28', '2026-08-28')] } }),
    'currency USD': () => ({ success: true, code: 0, result: { count: 1, pages: 1, data: [{ ...G('000958.SZ', '通用', '2026-06-30', '中报', 1, 1, '2026-08-28', '2026-08-28'), CURRENCY: 'USD' }] } }),
    'row for another period': () => ({ success: true, code: 0, result: { count: 1, pages: 1, data: [G('000958.SZ', '通用', '2025-06-30', '中报', 1, 1, '2026-08-28', '2026-08-28')] } }),
    'missing column': () => ({ success: true, code: 0, result: { count: 1, pages: 1, data: [{ SECUCODE: '000958.SZ' }] } }),
    'string number': () => ({ success: true, code: 0, result: { count: 1, pages: 1, data: [{ ...G('000958.SZ', '通用', '2026-06-30', '中报', 1, 1, '2026-08-28', '2026-08-28'), TOTAL_OPERATE_INCOME: '1,234' }] } }),
  };
  for (const [name, answer] of Object.entries(downCases)) {
    await test('CN source down / odd answer (' + name + '): exit 1, cn.json byte-identical', async () => {
      const dir = tmpDir();
      await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
      const h = sha(path.join(dir, 'cn.json'));
      const em = eastmoney(cnRows(), { before: (report, period) => (period === '2026-06-30' && report === 'RPT_F10_FINANCE_GINCOME' ? answer() : undefined) });
      const lines = [];
      const r = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: em, now: NOW('2026-10-16T07:00:00Z'), log: (m) => lines.push(m) });
      assert.equal(r.exitCode, 1);
      assert.ok(r.results[0].aborted);
      assert.ok(lines.some((l) => l.startsWith('::error::exchange-quarters CN aborted')), lines.join('\n'));
      assert.equal(sha(path.join(dir, 'cn.json')), h);
    });
  }

  await test('CN: the call cap aborts without writing (first run: no file at all)', async () => {
    const dir = tmpDir();
    const r = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-02T07:00:00Z'), cnCap: 5, log: quiet });
    assert.equal(r.exitCode, 1);
    assert.match(r.results[0].aborted, /call cap of 5/);
    assert.equal(fs.existsSync(path.join(dir, 'cn.json')), false);
  });

  await test('CN cadence: weekly outside the seasons (skip 2 days after a pass), daily inside, --force-cn overrides', async () => {
    const dir = tmpDir();
    await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    const em = eastmoney(cnRows());
    const r = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: em, now: NOW('2026-10-04T07:00:00Z'), log: quiet });
    assert.equal(r.results[0].skipped, true);
    assert.equal(em.log.length, 0);
    const r2 = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: em, now: NOW('2026-10-09T07:00:00Z'), log: quiet });
    assert.equal(r2.results[0].skipped, undefined, '7 days later the weekly pass runs');
    const r3 = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-16T07:00:00Z'), log: quiet });
    const r4 = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-17T07:00:00Z'), log: quiet });
    assert.equal(r3.results[0].skipped, undefined);
    assert.equal(r4.results[0].skipped, undefined, 'inside the October season the pass is daily');
    const r5 = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-11-22T07:00:00Z'), log: quiet });
    const r6 = await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-11-23T07:00:00Z'), forceCn: true, log: quiet });
    assert.equal(r5.results[0].skipped, undefined);
    assert.equal(r6.results[0].skipped, undefined);
  });

  await test('dry run fetches and checks but writes nothing', async () => {
    const dir = tmpDir();
    const r = await main({ dir, dryRun: true, tickers: TICKERS, fetchJson: async (u, o) => (o && o.body ? mops()(u, o) : eastmoney(cnRows())(u, o)),
      priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].written, false);
    assert.ok(r.results[1].ok > 0);
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  // ── Taiwan ─────────────────────────────────────────────────────────────────
  await test('TW: printed revenue line with its titles, thousand TWD, board rows first, 115Q3 not asked on 02.10.', async () => {
    const dir = tmpDir();
    const m = mops();
    const r = await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: m, priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    const s = read(dir, 'tw');
    assert.deepEqual(m.log.slice(0, 4).map((x) => x.b.companyId + ' ' + x.b.year + 'Q' + x.b.season), ['2548 115Q2', '2548 115Q1', '2548 114Q4', '2548 114Q3']);
    assert.equal(m.log[4].b.companyId, '6023', 'rank 30 before rank 140');
    assert.ok(!m.log.some((x) => x.b.season === '3' && x.b.year === '115'), '115Q3 is younger than 25 days');
    assert.ok(m.log.every((x) => x.url === 'https://mops.twse.com.tw/mops/api/t164sb04' && x.opts.pauseMs >= 1500));
    assert.ok(m.log.every((x) => x.opts.headers['Content-Type'] === 'application/json' && x.b.dataType === '2'));
    const o = s.companies['6446.TW'].seasons['114Q3'][0];
    assert.deepEqual(o.columns[0], ['114年第3季', 3893772]);
    assert.equal(o.line, '營業收入合計');
    assert.equal(S.taiwanSingleQuarters(Object.fromEntries(Object.entries(s.companies['6446.TW'].seasons).map(([k, v]) => [k, v[v.length - 1]])))['2025-12-31'], 4881238000);
    assert.equal(s.companies['6023.TWO'].seasons['115Q2'][0].line, '收益合計');
    assert.equal(s.companies['6023.TWO'].noData['114Q3'].code, 406);
    assert.equal(s.companies['2330.TW'].noData['115Q2'].code, 'failed');
    assert.equal(s.companies['1312A.TW'].noData['115Q2'].code, 'bad-id', 'MOPS rejects the preferred-share id: not a failure');
    assert.equal(r.results[0].failed, 4);
    assert.equal(r.results[0].badId, 4);
    assert.equal(s.sources['tw-20261002T070000Z'].badId, 4, 'the bad-id count is recorded in the source entry');
    assert.equal(s.unit, 1000);
    assert.match(s.about, /build-cnannual\.js lines 19-21/);
    assert.ok(!JSON.stringify(s).includes('mopsov'), 'urlList is never stored or followed');
  });

  await test('TW: the cap limits calls; the next run continues where the first stopped; refresh after 7 days', async () => {
    const dir = tmpDir();
    const m1 = mops();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: m1, priority: PRIORITY, twCap: 6, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(m1.log.length, 6);
    const m2 = mops();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: m2, priority: PRIORITY, now: NOW('2026-10-03T07:00:00Z'), log: quiet });
    // run 1 asked 2548 x4, 6023 115Q2 (ok) and 6023 115Q1 (406, waits 3 days) -> run 2 resumes at 6023 114Q4
    assert.equal(m2.log[0].b.companyId + ' ' + m2.log[0].b.year + 'Q' + m2.log[0].b.season, '6023 114Q4');
    const m3 = mops();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: m3, priority: PRIORITY, now: NOW('2026-10-04T07:00:00Z'), log: quiet });
    assert.deepEqual(m3.log.map((x) => x.b.companyId), ['2330', '2330', '2330', '2330'], 'only the failed keys come back the next day, not the rejected id');
    const m4 = mops();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: m4, priority: PRIORITY, now: NOW('2026-10-11T07:00:00Z'), log: quiet });
    const refreshed = m4.log.filter((x) => x.b.companyId !== '2330' && x.b.year === '115' && x.b.season === '2').map((x) => x.b.companyId).sort();
    assert.deepEqual(refreshed, ['2548', '6023', '6446'], 'the newest season of every stored company is re-read after 7 days');
    const s = read(dir, 'tw');
    assert.equal(s.companies['2548.TW'].seasons['115Q2'].length, 1);
    assert.equal(S.lastConfirmedAt(s, '2548.TW', '115Q2').slice(0, 10), '2026-10-11');
  });

  await test('TW: more than 20 % failed calls abort without writing; tw.json byte-identical', async () => {
    const dir = tmpDir();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: mops(), priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    const h = sha(path.join(dir, 'tw.json'));
    const m = mops({ before: (b, n) => (n % 3 === 0 ? { code: 500, message: 'x', result: null } : undefined) });
    const r = await main({ dir, markets: ['tw'], tickers: TICKERS.concat(['1101.TW', '1102.TW', '1103.TW', '1104.TW', '1216.TW']),
      fetchJson: m, priority: PRIORITY, now: NOW('2026-10-12T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 1);
    assert.match(r.results[0].aborted, /more than 20 %/);
    assert.equal(sha(path.join(dir, 'tw.json')), h);
  });

  await test('TW: 10 failures in a row abort early (systemic block), nothing written', async () => {
    const dir = tmpDir();
    const many = Array.from({ length: 12 }, (_, i) => (1101 + i) + '.TW');
    const m = mops({ before: () => { throw new Error('HTTP 403 (nicht wiederholbar)'); } });
    const r = await main({ dir, markets: ['tw'], tickers: many, fetchJson: m, priority: new Map(), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 1);
    assert.match(r.results[0].aborted, /10 failures in a row/);
    assert.equal(m.log.length, 10);
    assert.equal(fs.existsSync(path.join(dir, 'tw.json')), false);
  });

  await test('TW ceased (6a): twelve companies in a row no longer reporting do not abort; every season is recorded', async () => {
    const dir = tmpDir();
    const many = Array.from({ length: 12 }, (_, i) => (1258 + i) + '.TW');
    const m = mops({ before: (b) => ({ code: 500, message: '該 ' + b.companyId + ' 公開發行公司不繼續公開發行！', result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers: many, fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].aborted, undefined);
    assert.equal(r.results[0].written, true);
    assert.equal(m.log.length, 48, 'twelve companies, four due seasons each');
    assert.equal(r.results[0].ceased, m.log.length);
    assert.equal(r.results[0].failed, 0);
    const s = read(dir, 'tw');
    assert.deepEqual(Object.keys(s.companies).sort(), many);
    for (const { b } of m.log) {
      assert.deepEqual(s.companies[b.companyId + '.TW'].noData[b.year + 'Q' + b.season], { at: '2026-10-06T07:00:00.000Z', code: 'ceased' });
      assert.deepEqual(s.companies[b.companyId + '.TW'].seasons, {});
    }
    assert.equal(s.sources[r.results[0].src].ceased, m.log.length);
    assert.equal(s.sources[r.results[0].src].failed, 0);
  });

  await test('TW ceased (6b): another company id, a partial id, or any other answer remains a failure', async () => {
    const answers = [
      ...['1258', '11262', '12620', '1262A', ''].map((id) => ({ code: 500, message: '該 ' + id + ' 公開發行公司不繼續公開發行！', result: null })),
      { code: 500, message: '該 1262 unknown error', result: null },
      { code: 501, message: '該 1262 公開發行公司不繼續公開發行！', result: null },
      { code: 500, message: null, result: null },
    ];
    for (const answer of answers) {
      const dir = tmpDir();
      const m = mops({ before: () => answer });
      const r = await main({ dir, markets: ['tw'], tickers: ['1262.TW'], fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
      assert.equal(r.exitCode, 0, JSON.stringify(r));
      assert.equal(m.log.length, 4);
      assert.equal(r.results[0].failed, 4, JSON.stringify(answer));
      assert.equal(r.results[0].ceased, 0);
      const s = read(dir, 'tw');
      assert.deepEqual(Object.values(s.companies['1262.TW'].noData).map((x) => x.code), Array(4).fill('failed'));
      assert.equal(s.sources[r.results[0].src].failed, 4);
      assert.equal(s.sources[r.results[0].src].ceased, 0);
    }
  });

  await test('TW ceased (6c): missing and stored seasons wait 30 days, not queued after 10 days, queued after 31', () => {
    const seasons = S.taiwanSeasonWindow('2026-10-02').filter((s) => s.key === '115Q2');
    for (const stored of [false, true]) {
      const store = { sources: {}, companies: { '1262.TW': {
        seasons: stored ? { '115Q2': [{}] } : {}, noData: { '115Q2': { at: '2026-09-22T07:00:00Z', code: 'ceased' } },
      } } };
      assert.deepEqual(taiwanQueue(store, ['1262.TW'], seasons, new Map(), Date.parse('2026-10-02T07:00:00Z')), [], '10 days: stored=' + stored);
      assert.deepEqual(taiwanQueue(store, ['1262.TW'], seasons, new Map(), Date.parse('2026-10-23T07:00:00Z')).map((x) => x.s.key), ['115Q2'], '31 days: stored=' + stored);
    }
  });

  await test('TW ceased (6d): a previously reporting company keeps every stored season unchanged', async () => {
    const dir = tmpDir();
    const initial = await main({ dir, markets: ['tw'], tickers: ['2548.TW'], fetchJson: mops(), priority: new Map(), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(initial.exitCode, 0, JSON.stringify(initial));
    const before = read(dir, 'tw');
    assert.equal(Object.keys(before.companies['2548.TW'].seasons).length, 4);
    const m = mops({ before: (b) => ({ code: 500, message: '該 ' + b.companyId + ' 公開發行公司不繼續公開發行！', result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers: ['2548.TW'], fetchJson: m, priority: new Map(), now: NOW('2026-10-12T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(m.log.length, 1, 'only the newest stored season is due for refresh');
    assert.equal(r.results[0].ceased, 1);
    assert.equal(r.results[0].failed, 0);
    const after = read(dir, 'tw');
    assert.deepEqual(after.companies['2548.TW'].seasons, before.companies['2548.TW'].seasons);
    assert.deepEqual(after.companies['2548.TW'].noData['115Q2'], { at: '2026-10-12T07:00:00.000Z', code: 'ceased' });
    assert.equal(after.sources[r.results[0].src].ceased, 1);
    S.assertAppendOnly(before, after);
  });

  await test('TW ceased: a matching answer resets the consecutive failure count', async () => {
    const dir = tmpDir();
    const many = Array.from({ length: 15 }, (_, i) => (1258 + i) + '.TW');
    const m = mops({ before: (b, n) => ({ code: 500, message: n <= 9 || n === 11 ? 'unknown error' : '該 ' + b.companyId + ' 公開發行公司不繼續公開發行！', result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers: many, fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].written, true);
    assert.equal(m.log.length, 60);
    assert.equal(r.results[0].failed, 10);
    assert.equal(r.results[0].ceased, 50);
  });

  await test('TW delisted (7a): twelve companies in a row do not abort; every season is recorded', async () => {
    const dir = tmpDir();
    const many = Array.from({ length: 12 }, (_, i) => (1311 + i) + '.TW');
    const m = mops({ before: (b) => ({ code: 500, message: '該 ' + b.companyId + ' 上市公司已下市！', result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers: many, fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].aborted, undefined);
    assert.equal(r.results[0].written, true);
    assert.equal(m.log.length, 48, 'twelve companies, four due seasons each');
    assert.equal(r.results[0].calls, m.log.length);
    assert.equal(r.results[0].delisted, m.log.length);
    assert.equal(r.results[0].ceased, 0);
    assert.equal(r.results[0].failed, 0);
    const s = read(dir, 'tw');
    assert.deepEqual(Object.keys(s.companies).sort(), many);
    for (const { b } of m.log) {
      assert.deepEqual(s.companies[b.companyId + '.TW'].noData[b.year + 'Q' + b.season], { at: '2026-10-06T07:00:00.000Z', code: 'delisted' });
      assert.deepEqual(s.companies[b.companyId + '.TW'].seasons, {});
    }
    assert.equal(s.sources[r.results[0].src].delisted, m.log.length);
    assert.equal(s.sources[r.results[0].src].ceased, 0);
    assert.equal(s.sources[r.results[0].src].failed, 0);
  });

  await test('TW delisted (7b): another company id, a partial id, or any other answer remains a failure', async () => {
    const answers = [
      ...['1523', '11311', '13110', '1311A', ''].map((id) => ({ code: 500, message: '該 ' + id + ' 上市公司已下市！', result: null })),
      { code: 500, message: '該 1311 unknown error', result: null },
      { code: 500, message: '該 1311 上櫃公司已下櫃！', result: null },
      { code: 500, message: '該 1523 上市公司已下市！ 1311', result: null },
      { code: 501, message: '該 1311 上市公司已下市！', result: null },
      { code: '500', message: '該 1311 上市公司已下市！', result: null },
      { code: 500, message: null, result: null },
    ];
    for (const answer of answers) {
      const dir = tmpDir();
      const m = mops({ before: () => answer });
      const r = await main({ dir, markets: ['tw'], tickers: ['1311.TW'], fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
      assert.equal(r.exitCode, 0, JSON.stringify(r));
      assert.equal(m.log.length, 4);
      assert.equal(r.results[0].failed, 4, JSON.stringify(answer));
      assert.equal(r.results[0].delisted, 0);
      const s = read(dir, 'tw');
      assert.deepEqual(Object.values(s.companies['1311.TW'].noData).map((x) => x.code), Array(4).fill('failed'));
      assert.equal(s.sources[r.results[0].src].failed, 4);
      assert.equal(s.sources[r.results[0].src].delisted, 0);
    }
  });

  await test('TW delisted (7c): missing and stored seasons wait 30 days, not queued after 10 days, queued after 31', () => {
    const seasons = S.taiwanSeasonWindow('2026-10-02').filter((s) => s.key === '115Q2');
    for (const stored of [false, true]) {
      const store = { sources: {}, companies: { '1311.TW': {
        seasons: stored ? { '115Q2': [{}] } : {}, noData: { '115Q2': { at: '2026-09-22T07:00:00Z', code: 'delisted' } },
      } } };
      assert.deepEqual(taiwanQueue(store, ['1311.TW'], seasons, new Map(), Date.parse('2026-10-02T07:00:00Z')), [], '10 days: stored=' + stored);
      assert.deepEqual(taiwanQueue(store, ['1311.TW'], seasons, new Map(), Date.parse('2026-10-22T06:59:59Z')), [], 'less than 30 days: stored=' + stored);
      assert.deepEqual(taiwanQueue(store, ['1311.TW'], seasons, new Map(), Date.parse('2026-10-22T07:00:00Z')).map((x) => x.s.key), ['115Q2'], '30 days: stored=' + stored);
      assert.deepEqual(taiwanQueue(store, ['1311.TW'], seasons, new Map(), Date.parse('2026-10-23T07:00:00Z')).map((x) => x.s.key), ['115Q2'], '31 days: stored=' + stored);
    }
  });

  await test('TW delisted (7d): a previously reporting company keeps every stored season unchanged', async () => {
    const dir = tmpDir();
    const initial = await main({ dir, markets: ['tw'], tickers: ['2548.TW'], fetchJson: mops(), priority: new Map(), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(initial.exitCode, 0, JSON.stringify(initial));
    const before = read(dir, 'tw');
    assert.equal(Object.keys(before.companies['2548.TW'].seasons).length, 4);
    const m = mops({ before: (b) => ({ code: 500, message: '該 ' + b.companyId + ' 上市公司已下市！', result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers: ['2548.TW'], fetchJson: m, priority: new Map(), now: NOW('2026-10-12T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(m.log.length, 1, 'only the newest stored season is due for refresh');
    assert.equal(r.results[0].delisted, 1);
    assert.equal(r.results[0].failed, 0);
    const after = read(dir, 'tw');
    assert.deepEqual(after.companies['2548.TW'].seasons, before.companies['2548.TW'].seasons);
    assert.deepEqual(after.companies['2548.TW'].noData['115Q2'], { at: '2026-10-12T07:00:00.000Z', code: 'delisted' });
    assert.equal(after.sources[r.results[0].src].delisted, 1);
    S.assertAppendOnly(before, after);
  });

  await test('TW mixed (7e): ceased and delisted answers are counted separately in one run', async () => {
    const dir = tmpDir();
    const tickers = ['1262.TW', '1311.TW', '1523.TW', '2446.TW', '2463.TW'];
    const m = mops({ before: (b) => ({ code: 500, message: '該 ' + b.companyId + ' '
      + (b.companyId === '1262' ? '公開發行公司不繼續公開發行！' : '上市公司已下市！'), result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers, fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(m.log.length, 20);
    assert.equal(r.results[0].ceased, 4);
    assert.equal(r.results[0].delisted, 16);
    assert.equal(r.results[0].failed, 0);
    const s = read(dir, 'tw');
    for (const { b } of m.log) {
      assert.deepEqual(s.companies[b.companyId + '.TW'].noData[b.year + 'Q' + b.season],
        { at: '2026-10-06T07:00:00.000Z', code: b.companyId === '1262' ? 'ceased' : 'delisted' });
    }
    assert.equal(s.sources[r.results[0].src].ceased, 4);
    assert.equal(s.sources[r.results[0].src].delisted, 16);
    assert.equal(s.sources[r.results[0].src].failed, 0);
  });

  await test('TW delisted: a matching answer resets the consecutive failure count', async () => {
    const dir = tmpDir();
    const many = Array.from({ length: 15 }, (_, i) => (1311 + i) + '.TW');
    const m = mops({ before: (b, n) => ({ code: 500, message: n <= 9 || n === 11 ? 'unknown error' : '該 ' + b.companyId + ' 上市公司已下市！', result: null }) });
    const r = await main({ dir, markets: ['tw'], tickers: many, fetchJson: m, priority: new Map(), now: NOW('2026-10-06T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].written, true);
    assert.equal(m.log.length, 60);
    assert.equal(r.results[0].failed, 10);
    assert.equal(r.results[0].delisted, 50);
  });

  await test('TW queue: never-fetched keys first, then the newest season of each company after 7 days', () => {
    const seasons = S.taiwanSeasonWindow('2026-10-20');
    const store = { sources: { r1: { fetchedAt: '2026-10-10T00:00:00Z', read: ['2548.TW 115Q2'] } },
      companies: { '2548.TW': { seasons: { '115Q2': [{}], '115Q1': [{}], '114Q4': [{}], '114Q3': [{}] }, noData: {} } } };
    const q = taiwanQueue(store, ['2548.TW', '6446.TW'], seasons, new Map(), Date.parse('2026-10-20T00:00:00Z'));
    assert.deepEqual(q.map((x) => x.tk + ' ' + x.s.key), ['6446.TW 115Q2', '6446.TW 115Q1', '6446.TW 114Q4', '6446.TW 114Q3', '2548.TW 115Q2']);
    store.sources.r2 = { fetchedAt: '2026-10-22T00:00:00Z', read: ['2548.TW 115Q2'] };
    const q2 = taiwanQueue(store, ['2548.TW'], S.taiwanSeasonWindow('2026-10-26'), new Map(), Date.parse('2026-10-26T00:00:00Z'));
    assert.deepEqual(q2.map((x) => x.s.key), ['115Q3'], '25 days after 30.09. the new season is asked; the 115Q2 refresh is not due yet');
  });

  await test('TW: a quiet day with only rejected preferred-share ids due does not abort; they wait 30 days', async () => {
    // Review of 9ff07e9: 1312A.TW and 2002A.TW were retried daily as failures and made up 8 of 8 calls
    // on the quiet days of each refresh cycle -> false "more than 20 %" abort.
    const dir = tmpDir();
    const prefs = ['1312A.TW', '2002A.TW'];
    const m = mops({ before: () => BAD_ID });
    const r = await main({ dir, markets: ['tw'], tickers: prefs, fetchJson: m, priority: new Map(), now: NOW('2026-10-06T13:47:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(m.log.length, 8);
    assert.equal(r.results[0].failed, 0);
    assert.equal(r.results[0].badId, 8);
    const m2 = mops({ before: () => BAD_ID });
    await main({ dir, markets: ['tw'], tickers: prefs, fetchJson: m2, priority: new Map(), now: NOW('2026-10-07T13:47:00Z'), log: quiet });
    assert.equal(m2.log.length, 0, 'not asked again the next day');
    const m3 = mops({ before: () => BAD_ID });
    const r3 = await main({ dir, markets: ['tw'], tickers: prefs, fetchJson: m3, priority: new Map(), now: NOW('2026-11-06T13:47:00Z'), log: quiet });
    assert.equal(r3.exitCode, 0);
    assert.ok(m3.log.length > 0, 'asked again after 30 days');
  });

  // Review of 9277efb: a systemic 公司代號格式錯誤 during the fill phase (numeric ids never stored yet)
  // passed with exit 0 and parked every company for 30 days.
  await test('TW bad-id (a): the two real preferred-share ids among normal answers -> no abort, both recorded as bad-id', async () => {
    const dir = tmpDir();
    const m = mops({ before: (b) => (b.companyId === '2002A' ? BAD_ID : undefined) });
    const r = await main({ dir, markets: ['tw'], tickers: TICKERS.concat(['2002A.TW']), fetchJson: m, priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].badId, 8);
    const s = read(dir, 'tw');
    assert.equal(s.companies['1312A.TW'].noData['115Q2'].code, 'bad-id');
    assert.equal(s.companies['2002A.TW'].noData['114Q3'].code, 'bad-id');
  });

  await test('TW bad-id (b): every id answers 公司代號格式錯誤 in the fill phase -> abort, tw.json byte-identical, exit 1', async () => {
    const dir = tmpDir();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: mops(), priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    const h = sha(path.join(dir, 'tw.json'));
    const fresh = Array.from({ length: 12 }, (_, i) => (1101 + i) + '.TW');   // never stored: the fill phase
    const m = mops({ before: () => BAD_ID });
    const lines = [];
    const r = await main({ dir, markets: ['tw'], tickers: TICKERS.concat(fresh), fetchJson: m, priority: PRIORITY, now: NOW('2026-10-12T07:00:00Z'), log: (x) => lines.push(x) });
    assert.equal(r.exitCode, 1, JSON.stringify(r));
    assert.ok(r.results[0].aborted, JSON.stringify(r));
    assert.ok(lines.some((l) => l.startsWith('::error::exchange-quarters TW aborted')), lines.join('\n'));
    assert.equal(sha(path.join(dir, 'tw.json')), h);
  });

  await test('TW bad-id (c): a quiet day whose only two calls are the two preferred-share ids -> no abort', async () => {
    const dir = tmpDir();
    const prefs = ['1312A.TW', '2002A.TW'];
    await main({ dir, markets: ['tw'], tickers: prefs, fetchJson: mops({ before: () => BAD_ID }), priority: new Map(), now: NOW('2026-10-06T13:47:00Z'), log: quiet });
    const m = mops({ before: () => BAD_ID });
    const r = await main({ dir, markets: ['tw'], tickers: prefs, fetchJson: m, priority: new Map(), now: NOW('2026-10-26T13:47:00Z'), log: quiet });
    assert.deepEqual(m.log.map((x) => x.b.companyId + ' ' + x.b.year + 'Q' + x.b.season), ['1312A 115Q3', '2002A 115Q3'], '115Q3 becomes due 25 days after 30.09.');
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].badId, 2);
    assert.equal(r.results[0].failed, 0);
  });

  await test('TW: 公司代號格式錯誤 for a company that already has stored seasons is a failure (systemic, not a bad id)', async () => {
    const dir = tmpDir();
    await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: mops(), priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    const m = mops({ before: () => BAD_ID });
    const r = await main({ dir, markets: ['tw'], tickers: ['2548.TW'], fetchJson: m, priority: PRIORITY, now: NOW('2026-10-12T07:00:00Z'), log: quiet });
    assert.equal(m.log.length, 1, 'the 7-day refresh of 2548 115Q2');
    assert.equal(r.results[0].badId, 0);
    assert.equal(r.results[0].failed, 1);
    assert.equal(read(dir, 'tw').companies['2548.TW'].noData['115Q2'].code, 'failed');
  });

  await test('TW: an answer for another year or season, or with two revenue lines, is a failure and stores nothing', async () => {
    const dir = tmpDir();
    const m = mops({ before: (b) => {
      if (b.companyId === '6446' && b.year === '115' && b.season === '2') return okAnswer(b, ROWS['6446|115|2'], { year: '114' });
      if (b.companyId === '6446' && b.year === '115' && b.season === '1') return okAnswer(b, ROWS['6446|115|1'], { season: '2' });
      if (b.companyId === '2548' && b.year === '115' && b.season === '2') return okAnswer(b, ROWS['2548|115|2'], { reportList: [ROWS['2548|115|2'], ROWS['2548|115|2']] });
      return undefined;
    } });
    const r = await main({ dir, markets: ['tw'], tickers: ['2548.TW', '6446.TW'], fetchJson: m, priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
    assert.equal(r.exitCode, 0, JSON.stringify(r));
    assert.equal(r.results[0].failed, 3);
    const s = read(dir, 'tw');
    assert.equal(s.companies['6446.TW'].seasons['115Q2'], undefined, 'wrong year');
    assert.equal(s.companies['6446.TW'].seasons['115Q1'], undefined, 'wrong season');
    assert.equal(s.companies['2548.TW'].seasons['115Q2'], undefined, 'two revenue lines');
    assert.deepEqual(['6446.TW 115Q2', '6446.TW 115Q1', '2548.TW 115Q2'].map((k) => { const [tk, key] = k.split(' '); return s.companies[tk].noData[key].code; }), ['failed', 'failed', 'failed']);
    assert.equal(s.companies['6446.TW'].seasons['114Q3'].length, 1, 'the good answers are stored');
  });

  await test('the append-only guard runs before every write: a merge bug that rewrites an old observation aborts, file unchanged', async () => {
    const orig = S.mergeObservation;
    // Simulated bug: overwrite the stored observation instead of appending (what the guard exists for).
    const rewriting = (list, fresh, conf) => (list.length ? (list[0] = { ...fresh, confirmedBy: list[0].confirmedBy }, 'confirmed') : orig(list, fresh, conf));
    try {
      const dir = tmpDir();
      await main({ dir, markets: ['cn'], tickers: TICKERS, fetchJson: eastmoney(cnRows()), now: NOW('2026-10-02T07:00:00Z'), log: quiet });
      await main({ dir, markets: ['tw'], tickers: TICKERS, fetchJson: mops(), priority: PRIORITY, now: NOW('2026-10-02T07:00:00Z'), log: quiet });
      const h = { cn: sha(path.join(dir, 'cn.json')), tw: sha(path.join(dir, 'tw.json')) };
      const rows = cnRows();
      rows.RPT_F10_FINANCE_GINCOME['2025-09-30'][1].TOTAL_OPERATE_INCOME = 2399700000;
      const changedTw = mops({ before: (b) => (b.companyId === '2548' && b.year === '115' && b.season === '2'
        ? okAnswer(b, ['營業收入合計', '1,501,064', '100.00', '2,016,550', '100.00', '5,707,481', '100.00', '2,028,004', '100.00']) : undefined) });
      S.mergeObservation = rewriting;
      const r = await main({ dir, tickers: TICKERS, fetchJson: async (u, o) => (o && o.body ? changedTw(u, o) : eastmoney(rows)(u, o)),
        priority: PRIORITY, now: NOW('2026-10-12T07:00:00Z'), log: quiet });
      assert.equal(r.exitCode, 1);
      assert.match(r.results[0].aborted, /append-only violated/);
      assert.match(r.results[1].aborted, /append-only violated/);
      assert.deepEqual({ cn: sha(path.join(dir, 'cn.json')), tw: sha(path.join(dir, 'tw.json')) }, h);
    } finally {
      S.mergeObservation = orig;
    }
  });

  // the live store was never touched by this file
  await test('the live store files are byte-identical before and after this test file', () => {
    assert.deepEqual({ cn: sha(path.join(LIVE_DIR, 'cn.json')), tw: sha(path.join(LIVE_DIR, 'tw.json')) }, liveBefore);
  });

  console.log('\nfetch-exchange-quarters: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
