'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const F = require('../scripts/fetch-cn-printed');
const S = require('../lib/exchange-quarter-store');
const H = require('./cn-printed.helpers');
global.fetch = () => { throw Error('NETWORK IS FORBIDDEN IN TESTS'); };
const before = H.liveHashes();
let passed = 0;
async function test(name, fn) { await fn(); passed++; }
const now = () => new Date('2026-11-12T12:00:00Z');
const fixture = H.fixture('002415.SZ');
const ann = { secCode: '002415', announcementTitle: '2026年三季度报告', announcementId: '1225607861',
  adjunctUrl: 'finalpage/2026-10-17/1225607861.PDF', announcementTime: Date.parse('2026-10-16T16:00:00Z') };
const meta = F.announcementMeta(ann, fixture.ticker, 2026, '2026-11-12');
const jsonResponse = data => ({ ok: true, json: async () => data });
function environment(fixtures = [fixture]) {
  const dir = H.sandbox(), cnStore = path.join(dir, 'cn.json'), store = path.join(dir, 'cn-printed.json');
  fs.writeFileSync(cnStore, JSON.stringify(H.vendorStore(fixtures)));
  return { dir, cnStore, store, cacheDir: path.join(dir, 'cache'), now, tickers: fixtures.map(f => f.ticker) };
}
function mockClient(handler) { let n = 0; return { request: async (...args) => { n++; return handler(...args); }, calls: () => n }; }

(async () => {
  await test('title/year/security/report specificity and notice day', () => {
    assert.equal(meta.noticeDate, '2026-10-17');
    for (const title of ['2025年三季度报告', '2026年三季度报告摘要', '2026年三季度报告英文版', '2026年半年度报告', '2026年三季度报告更正公告']) {
      assert.equal(F.announcementMeta({ ...ann, announcementTitle: title }, fixture.ticker, 2026, '2026-11-12'), null);
    }
    assert.equal(F.announcementMeta({ ...ann, secCode: '000001' }, fixture.ticker, 2026, '2026-11-12'), null);
    assert.equal(F.announcementMeta({ ...ann, announcementId: 'wrong' }, fixture.ticker, 2026, '2026-11-12'), null);
    assert.equal(F.announcementMeta(ann, fixture.ticker, 2026, '2026-10-16'), null);
    assert.equal(F.announcementMeta({ ...ann, adjunctUrl: '../../secret' }, fixture.ticker, 2026, '2026-11-12'), null);
  });
  await test('sequential request spacing includes retries and response completion', async () => {
    let time = 0; const starts = [], waits = [], fetchOptions = [];
    const c = F.createClient({ now: () => time, sleep: async n => { waits.push(n); time += n; }, fetchImpl: async (u, opts) => {
      starts.push(time); fetchOptions.push(opts); time += 20;
      if (starts.length === 1) return { ok: false, status: 503 };
      return jsonResponse({ ok: true });
    } });
    await c.request('http://example.test', { keyWord: '002415' });
    await c.request('http://example.test', { keyWord: '002415' });
    assert.deepEqual(starts, [0, 1520, 3040]); assert.deepEqual(waits, [1500, 1500]);
    assert.equal(c.calls(), 3); assert.ok(fetchOptions.every(o => o.redirect === 'error'));
  });
  await test('permanent errors and malformed JSON are never retried', async () => {
    let calls = 0;
    const client = F.createClient({ fetchImpl: async () => { calls++; return { ok: false, status: 403 }; } });
    await assert.rejects(client.request('http://example.test', {}), /http-403/); assert.equal(calls, 1);
    const bad = F.createClient({ fetchImpl: async () => { calls++; return { ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }; } });
    await assert.rejects(bad.request('http://example.test', {}), SyntaxError); assert.equal(calls, 2);
  });
  await test('only three transient attempts', async () => {
    let calls = 0;
    const client = F.createClient({ sleep: async () => {}, fetchImpl: async () => { calls++; return { ok: false, status: 429 }; } });
    await assert.rejects(client.request('http://example.test', {}), /http-429/); assert.equal(calls, 3);
  });
  await test('search selects exact code, latest full Q3 and paginates', async () => {
    const seen = [];
    const client = mockClient((u, form) => {
      seen.push(form);
      if (u.includes('topSearch')) return [{ code: '002415', orgId: 'gssz0020415' }];
      if (form.pageNum === '1') return { announcements: [{ ...ann, announcementTitle: '2026年三季度报告摘要' }], hasMore: true };
      return { announcements: [ann], hasMore: false };
    });
    assert.equal((await F.findAnnouncement(client, fixture.ticker, 2026, '2026-11-12')).announcementId, ann.announcementId);
    assert.equal(seen[1].stock, '002415,gssz0020415'); assert.equal(seen[1].column, 'szse'); assert.equal(seen[2].pageNum, '2');
  });
  await test('ambiguous organisation fails closed', async () => {
    const c = mockClient(() => [{ code: '002415', orgId: 'one' }, { code: '002415', orgId: 'two' }]);
    await assert.rejects(F.findAnnouncement(c, fixture.ticker, 2026, '2026-11-12'), /ambiguous/);
  });
  await test('PDF cache is keyed by announcement, extraction separate, no second download', async () => {
    const dir = H.sandbox(); let conversions = 0;
    const c = mockClient(() => Buffer.from('%PDF-test-fixture'));
    const convert = (pdf, txt) => { conversions++; assert.equal(path.basename(pdf), ann.announcementId + '.pdf'); fs.writeFileSync(txt, fixture.text); return fixture.text; };
    const a = await F.cachedText(c, meta, dir, convert), b = await F.cachedText(c, meta, dir, convert);
    assert.deepEqual(a, b); assert.equal(c.calls(), 1); assert.equal(conversions, 1);
  });
  await test('failed extraction cannot publish or reuse partial text', async () => {
    const dir = H.sandbox(), txt = path.join(dir, ann.announcementId + '.txt');
    const client = mockClient(() => Buffer.from('%PDF-test'));
    let partial;
    await assert.rejects(F.cachedText(client, meta, dir, (pdf, temp) => {
      partial = temp; fs.writeFileSync(temp, 'partial text'); throw Error('extractor-timeout');
    }), /extractor-timeout/);
    assert.equal(fs.existsSync(partial), false);
    assert.equal(fs.existsSync(txt), false);
    let conversions = 0;
    const convert = (pdf, temp) => { conversions++; assert.notEqual(temp, txt); fs.writeFileSync(temp, fixture.text); };
    assert.equal((await F.cachedText(client, meta, dir, convert)).text, fixture.text);
    assert.equal(conversions, 1); assert.equal(client.calls(), 1);
    await F.cachedText(client, meta, dir, convert); assert.equal(conversions, 1);
    fs.writeFileSync(txt, 'corrupted text');
    await F.cachedText(client, meta, dir, convert); assert.equal(conversions, 2);
  });
  await test('unmarked, empty and nonzero extraction results are never reused', async () => {
    const dir = H.sandbox(), txt = path.join(dir, ann.announcementId + '.txt');
    fs.writeFileSync(txt, 'legacy incomplete text');
    const client = mockClient(() => Buffer.from('%PDF-test'));
    await assert.rejects(F.cachedText(client, meta, dir, (pdf, temp) => { fs.writeFileSync(temp, ''); }), /text-empty/);
    await assert.rejects(F.cachedText(client, meta, dir, (pdf, temp) => { fs.writeFileSync(temp, 'partial'); return { status: 1 }; }), /extractor-exit/);
    let calls = 0;
    const result = await F.cachedText(client, meta, dir, (pdf, temp) => { calls++; fs.writeFileSync(temp, fixture.text); return { status: 0 }; });
    assert.equal(calls, 1); assert.equal(result.text, fixture.text);
    assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')).length, 0);
  });
  await test('HTML masquerading as PDF never cached', async () => {
    const dir = H.sandbox();
    await assert.rejects(F.cachedText(mockClient(() => Buffer.from('<html>bad</html>')), meta, dir), /pdf-invalid/);
    assert.equal(fs.existsSync(path.join(dir, ann.announcementId + '.pdf')), false);
  });
  await test('live orchestration capped and append-only, using mocked HTTP and extractor', async () => {
    const env = environment();
    const client = mockClient(u => u.includes('topSearch') ? [{ code: '002415', orgId: 'one' }]
      : u.includes('hisAnnouncement') ? { announcements: [ann], hasMore: false } : Buffer.from('%PDF-test'));
    const convert = (pdf, txt) => { fs.writeFileSync(txt, fixture.text); return fixture.text; };
    const r = await F.main({ ...env, cap: 1, client, convert });
    assert.equal(r.parsed, 1); assert.equal(r.read.length, 1); assert.equal(r.gate300, null);
    const old = JSON.parse(fs.readFileSync(env.store));
    await F.main({ ...env, cap: 1, client, convert, now: () => new Date('2026-11-12T12:01:00Z') });
    const next = JSON.parse(fs.readFileSync(env.store));
    S.assertAppendOnly(old, next);
    assert.equal(next.companies[fixture.ticker].reports[ann.announcementId].length, 1);
    assert.equal(Object.keys(next.sources).length, 2);
    const mutation = JSON.parse(JSON.stringify(next));
    mutation.companies[fixture.ticker].reports[ann.announcementId][0].growth.value = 999;
    assert.throws(() => S.assertAppendOnly(next, mutation), /observation changed/);
    const removed = JSON.parse(JSON.stringify(next)); delete removed.companies[fixture.ticker];
    assert.throws(() => S.assertAppendOnly(next, removed), /company removed/);
  });
  await test('one CNINFO failure reddens this pass only; later ticker still written; no numeric gap', async () => {
    const other = H.fixture('002475.SZ'), env = environment([fixture, other]);
    const client = mockClient((u, form) => {
      if (u.includes('topSearch')) {
        if (form.keyWord === '002415') throw Error('cninfo-http-503');
        return [{ code: '002475', orgId: 'one' }];
      }
      if (u.includes('hisAnnouncement')) return { announcements: [{ secCode: '002475', announcementTitle: '2026年第三季度报告', announcementId: '1225645369', adjunctUrl: 'finalpage/2026-10-30/1225645369.PDF' }], hasMore: false };
      return Buffer.from('%PDF-test');
    });
    fs.writeFileSync(path.join(env.dir, 'tw.json'), 'taiwan-sentinel'); fs.writeFileSync(path.join(env.dir, 'br.json'), 'brazil-sentinel');
    const cnBefore = fs.readFileSync(env.cnStore, 'utf8');
    const r = await F.main({ ...env, client, convert: (pdf, txt) => { fs.writeFileSync(txt, other.text); return other.text; } });
    assert.equal(r.exitCode, 1); assert.equal(r.parsed, 1); assert.equal(r.unparsed, 1);
    const s = JSON.parse(fs.readFileSync(env.store)), gap = s.companies[fixture.ticker].reports['gap-2026Q3'][0];
    assert.equal(gap.current, undefined); assert.equal(gap.reason, 'cninfo-http-503');
    assert.equal(fs.readFileSync(env.cnStore, 'utf8'), cnBefore);
    assert.equal(fs.readFileSync(path.join(env.dir, 'tw.json'), 'utf8'), 'taiwan-sentinel');
    assert.equal(fs.readFileSync(path.join(env.dir, 'br.json'), 'utf8'), 'brazil-sentinel');
  });
  await test('caps and output protections cannot be disabled', async () => {
    for (const cap of [0, 301, -1, 1.5]) await assert.rejects(F.main({ cap }), /cap-must/);
    await assert.rejects(F.main({ store: path.join(H.sandbox(), 'cn.json'), now }), /shadow-output/);
    assert.throws(() => F.cliArgs(['--cap=']), /flag/); assert.throws(() => F.cliArgs(['--unknown=1']), /flag/);
  });
  await test('cap counts attempted reports and a later run progresses beyond the old cap', async () => {
    const other = H.fixture('002475.SZ'), env = environment([fixture, other]), seen = [];
    const client = mockClient((u, form) => { seen.push(form.keyWord); throw Error('cninfo-http-403'); });
    const first = await F.main({ ...env, cap: 1, client });
    assert.deepEqual(first.read, [fixture.ticker]); assert.deepEqual(seen, ['002415']);
    const second = await F.main({ ...env, cap: 1, client, now: () => new Date('2026-11-12T12:02:00Z') });
    assert.deepEqual(second.read, [other.ticker]); assert.deepEqual(seen, ['002415', '002475']);
  });
  await test('cache metadata cannot escape the cache directory', async () => {
    await assert.rejects(F.cachedText(mockClient(() => { throw Error('must-not-fetch'); }),
      { ...meta, announcementId: '../bad' }, H.sandbox()), /pdf-metadata-invalid/);
  });
  await test('announcement shape guard distinguishes malformed lists from an empty valid list', async () => {
    for (const response of [null, {}, { announcements: null }, { announcements: {} }, { announcements: 'not-a-list' }]) {
      const client = mockClient(u => u.includes('topSearch') ? [{ code: '002415', orgId: 'one' }] : response);
      await assert.rejects(F.findAnnouncement(client, fixture.ticker, 2026, '2026-11-12'), /cninfo-announcement-shape/);
    }
    const client = mockClient(u => u.includes('topSearch') ? [{ code: '002415', orgId: 'one' }] : { announcements: [], hasMore: false });
    await assert.rejects(F.findAnnouncement(client, fixture.ticker, 2026, '2026-11-12'), /q3-report-not-found/);
  });
  await test('two 300-report runs are disjoint and exchange alternating, even after 300 failures', async () => {
    const env = environment([]);
    const tickers = Array.from({ length: 400 }, (_, i) => ['00' + String(i).padStart(4, '0') + '.SZ', '6' + String(i).padStart(5, '0') + '.SS']).flat();
    const client = mockClient(() => { throw Error('cninfo-http-403'); });
    const a = await F.main({ ...env, tickers, cap: 300, client });
    const b = await F.main({ ...env, tickers, cap: 300, client, now: () => new Date('2026-11-12T12:05:00Z') });
    assert.equal(a.read.length, 300); assert.equal(b.read.length, 300);
    assert.equal(b.read.filter(t => a.read.includes(t)).length, 0);
    assert.equal(a.parsed, 0); assert.equal(b.parsed, 0);
    assert.deepEqual(a.read, tickers.slice(0, 300)); assert.deepEqual(b.read, tickers.slice(300, 600));
    const old = JSON.parse(fs.readFileSync(env.store));
    const c = await F.main({ ...env, tickers, cap: 300, onlyNew: true, client, now: () => new Date('2026-11-12T12:10:00Z') });
    assert.deepEqual(c.read, tickers.slice(600)); assert.equal(c.gate300, null); assert.equal(c.onlyNew, true);
    S.assertAppendOnly(old, JSON.parse(fs.readFileSync(env.store)));
    const saved = fs.readFileSync(env.store, 'utf8'), calls = client.calls();
    await assert.rejects(F.main({ ...env, tickers, onlyNew: true, client }), /no-a-shares-in-input/);
    assert.equal(fs.readFileSync(env.store, 'utf8'), saved); assert.equal(client.calls(), calls);
  });
  await test('only-new checks companies and all source attempts, including other years', () => {
    const old = { companies: { '000001.SZ': { reports: {} } }, sources: {
      a: { year: 2025, fetchedAt: '2025-11-12', read: ['600001.SS'] },
      b: { year: 2026, fetchedAt: '2026-11-12', read: ['000002.SZ'] }
    } };
    assert.deepEqual(F.selectQueue(['000001.SZ', '000002.SZ', '600001.SS', '600002.SS'], old, 2026, 300, true), ['600002.SS']);
    // Removing either history witness must make the exclusion assertion red.
    for (const broken of [{ ...old, companies: {} }, { ...old, sources: {} }]) {
      assert.throws(() => assert.deepEqual(F.selectQueue(['000001.SZ', '000002.SZ', '600001.SS', '600002.SS'], broken, 2026, 300, true), ['600002.SS']));
    }
  });
  await test('default queue retains oldest-read-first, ties alternate by exchange', () => {
    const old = { companies: {}, sources: {
      a: { year: 2026, fetchedAt: '2026-11-10', read: ['000001.SZ', '600001.SS'] },
      b: { year: 2026, fetchedAt: '2026-11-11', read: ['000001.SZ'] }
    } };
    assert.deepEqual(F.selectQueue(['000001.SZ', '600001.SS', '000002.SZ', '600002.SS'], old, 2026, 300),
      ['000002.SZ', '600002.SS', '600001.SS', '000001.SZ']);
  });
  await test('only-new CLI is explicit and rejects misspelled truth values', async () => {
    assert.equal(F.cliArgs(['--only-new=true']).onlyNew, true);
    assert.equal(F.cliArgs(['--only-new=false']).onlyNew, false);
    assert.throws(() => F.cliArgs(['--only-new=yes']), /only-new/);
    await assert.rejects(F.main({ onlyNew: 'false' }), /only-new/);
  });
  assert.deepEqual(H.liveHashes(), before);
  console.log(`${passed} fetch tests passed; production CN/TW/BR/shadow hashes unchanged; no network.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
