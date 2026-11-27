'use strict';
const assert = require('assert/strict');
const { manifest, fixture, vendorStore } = require('./cn-printed.helpers');
const P = require('../scripts/cn-printed-parser');
let passed = 0;
function test(name, fn) { fn(); passed++; }
for (const m of manifest) test(m.ticker, () => {
  const f = fixture(m.ticker), p = P.parseText(f.text, f.anchor, { ticker: f.ticker });
  assert.equal(p.parseStatus, 'parsed', f.ticker + ': ' + p.reason);
  assert.equal(p.growth.value, f.expectedGrowth);
  assert.equal(p.unit, f.unit);
  assert.equal(p.priorValues?.after.value ?? null, f.expectedPrior);
  assert.equal(P.compare(p, f.priorAnchor).status, 'agree');
  assert.ok(p.quoteLines.length && p.quoteLines.every(q => f.text.split('\n')[q.line - 1] === q.text));
});
const f = fixture('002415.SZ');
const parse = (text, anchor = f.anchor) => P.parseText(text, anchor, { ticker: f.ticker });
const good = parse(f.text);
test('wrong current anchor is a named gap without numeric values', () => {
  const p = parse(f.text, { ...f.anchor, current: f.anchor.current * 1.01 });
  assert.equal(p.parseStatus, 'unparsed'); assert.equal(p.current, undefined); assert.equal(p.growth, undefined);
});
test('wrong YTD anchor cannot be bypassed by the matching quarter', () => assert.equal(parse(f.text, { ...f.anchor, ytd: f.anchor.ytd * 1.001 }).parseStatus, 'unparsed'));
test('total-revenue is not an alternate anchor', () => assert.equal(parse(f.text, { ...f.anchor, line: 'total' }).parseStatus, 'unparsed'));
test('wrong ticker and year refused', () => {
  assert.equal(P.parseText(f.text, f.anchor, { ticker: '002416.SZ' }).reason, 'security-code-not-in-header');
  assert.equal(P.parseText(f.text, f.anchor, { ticker: f.ticker, year: 2025 }).reason, 'report-year-not-in-header');
});
test('unrecognised currency scale refused', () => assert.equal(parse(f.text, { ...f.anchor, current: f.anchor.current * 100, ytd: f.anchor.ytd * 100 }).parseStatus, 'unparsed'));
test('missing growth is not guessed from Eastmoney', () => {
  // Remove the ENTIRE growth column, not merely the first value (which changes the layout).
  const text = f.text.split('\n').map(l => l.replace(/-?[\d,.]+%/g, s => ' '.repeat(s.length))).join('\n');
  assert.equal(parse(text).reason, 'growth-column-missing');
});
test('missing revenue growth marker cannot select the next profit growth', () => {
  assert.equal(parse(f.text.replace('13.71%', '  --  ')).reason, 'growth-column-missing-marker');
});
test('repeated revenue anchors refused', () => assert.equal(parse(f.text + '\n' + f.text).reason, 'ambiguous-revenue-anchors'));
test('unreadable text is a gap', () => assert.equal(parse('').reason, 'text-empty'));
test('singular growth denominator refused', () => assert.equal(parse(f.text.replace('13.71%', '-100.0%')).reason, 'growth-denominator-nonpositive'));
test('different Chinese total-revenue label refused', () => assert.equal(parse(f.text.replace('27,221,794,841.81', '营业总收入 27,221,794,841.81')).parseStatus, 'unparsed'));
test('an arbitrary inserted prior column is unknown', () => {
  const text = f.text.replace('27,221,794,841.81  13.71%', '27,221,794,841.81  9,999  ');
  assert.equal(parse(text).parseStatus, 'unparsed');
});
test('rounding interval uses both current decimals and growth decimals', () => {
  const c = P.comparable(good), a = good.current, g = good.growth;
  assert.equal(c.lower, (a.value - 0.005) / (1 + (g.value + 0.005) / 100));
  assert.equal(c.upper, (a.value + 0.005) / (1 + (g.value - 0.005) / 100));
  assert.equal(P.compare(good, { current: c.lower }).status, 'agree');
  assert.equal(P.compare(good, { current: c.upper }).status, 'agree');
  assert.equal(P.compare(good, { current: c.upper + 1 }).status, 'mixed-basis');
  assert.equal(P.compare(good, { current: c.lower - 1 }).status, 'mixed-basis');
});
test('one-decimal growth has the printed wider band', () => {
  const f = fixture('600871.SS'), p = P.parseText(f.text, f.anchor, { ticker: f.ticker });
  assert.equal(p.growth.roundingHalfWidth, 0.05); assert.equal(p.current.roundingHalfWidth, 500);
});
test('adjusted prior wins over unadjusted; consistency tested', () => {
  const f = fixture('600031.SS');
  const changedBefore = f.text.replace('21,207,370 21,207,370', '20,207,370 21,207,370');
  const p = P.parseText(changedBefore, f.anchor, { ticker: f.ticker });
  assert.equal(p.parseStatus, 'parsed'); assert.equal(P.comparable(p).value, 21207370000);
  assert.equal(p.priorValues.before.value, 20207370000);
  const changedAfter = f.text.replace('21,207,370 21,207,370', '21,207,370 20,207,370');
  assert.equal(P.parseText(changedAfter, f.anchor, { ticker: f.ticker }).reason, 'printed-prior-growth-inconsistent');
});
test('prior absence is distinguished from mixed basis', () => {
  assert.equal(P.compare(good, null).status, 'printed-only');
  assert.equal(P.compare({ parseStatus: 'unparsed', reason: 'example' }, null).status, 'unparsed');
});
test('missing is never zero; currency and report chain validated', () => {
  const s = vendorStore([f]);
  assert.ok(P.eastmoneyAnchor(s, f.ticker));
  s.companies[f.ticker].ytd['2026-06-30'][0].operate = null;
  assert.equal(P.eastmoneyAnchor(s, f.ticker), null);
  s.companies[f.ticker].ytd['2026-06-30'][0].operate = 0;
  assert.ok(P.eastmoneyAnchor(s, f.ticker));
  s.companies[f.ticker].ytd['2026-06-30'][0].reportType = '三季报';
  assert.equal(P.eastmoneyAnchor(s, f.ticker), null);
  s.currency = 'USD'; assert.equal(P.eastmoneyAnchor(s, f.ticker), null);
});
// K2: rows the layout text cannot place are bound on the pdftotext -table line (text excerpts).
const fs = require('fs'), path = require('path'), vm = require('vm');
const K2 = path.join(__dirname, 'fixtures/cn-printed-k2');
const k2 = JSON.parse(fs.readFileSync(path.join(K2, 'manifest.json'), 'utf8')).map(m => ({ ...m,
  text: fs.readFileSync(path.join(K2, m.ticker + '.layout.txt'), 'utf8'), table: fs.readFileSync(path.join(K2, m.ticker + '.table.txt'), 'utf8') }));
const editCell = (text, s, replacement) => {
  const lines = text.split('\n');
  assert.equal(lines[s.row].slice(s.x, s.end), s.raw, 'exact source cell');
  lines[s.row] = lines[s.row].slice(0, s.end - replacement.length) + replacement + lines[s.row].slice(s.end);
  return lines.join('\n');
};
function k2Suite(Parser) {
  let ok = 0;
  const t = (name, fn) => { fn(); ok++; };
  for (const m of k2) {
    const parse = (table = m.table, text = m.text) => Parser.parseText(text, m.anchor, { ticker: m.ticker, tableText: table });
    t('k2 layout text alone stays a named gap ' + m.ticker, () => {
      const p = Parser.parseText(m.text, m.anchor, { ticker: m.ticker });
      assert.equal(p.parseStatus, 'unparsed'); assert.equal(p.reason, m.layoutReason); assert.equal(p.growth, undefined);
    });
    t('k2 table line binds ' + m.ticker + ' (' + m.case + ')', () => {
      const p = parse();
      assert.equal(p.parseStatus, 'parsed', p.reason + ' / ' + p.tableReason);
      assert.equal(p.layout, m.expected.layout); assert.equal(p.growth.value, m.expected.growth);
      assert.equal(p.unit, m.expected.unit); assert.equal(p.priorValues?.after.value ?? null, m.expected.prior);
      assert.equal(p.extraction, 'pdftotext-table'); assert.equal(Parser.compare(p, m.priorAnchor).status, 'agree');
      assert.deepEqual(p.quoteLines.map(q => q.text), [m.table.split('\n')[m.slot.row]]);
    });
    t('k2 blank revenue growth never borrows another row ' + m.ticker, () => {
      const p = parse(editCell(m.table, m.slot, ' '.repeat(m.slot.raw.length)));
      assert.equal(p.parseStatus, 'unparsed'); assert.equal(p.growth, undefined);
      assert.equal(p.reason, m.layoutReason);
      // Restated rows: the adjusted prior is then the last cell and is refused as a growth.
      assert.ok(['growth-column-missing', 'unknown-prior-column-layout'].includes(p.tableReason), p.tableReason);
      if (m.expected.prior === null) assert.equal(p.tableReason, 'growth-column-missing');
    });
    t('k2 marker and foreign minus refused ' + m.ticker, () => {
      assert.equal(parse(editCell(m.table, m.slot, '--')).tableReason, 'growth-column-missing-marker');
      assert.equal(parse(editCell(m.table, m.slot, '−' + m.slot.raw.replace(/^-/, ''))).tableReason, 'growth-token-sign-unknown');
    });
    t('k2 table text of another report is refused ' + m.ticker, () => {
      const other = k2.find(o => o.ticker !== m.ticker);
      assert.equal(parse(other.table).tableReason, 'security-code-not-in-header');
      const header = m.table.split('\n').slice(0, 20).join('\n');
      assert.equal(parse(header + '\n' + other.table.split('\n').slice(20).join('\n')).tableReason, 'table-revenue-row-not-found');
    });
    t('k2 identity refusals are not overridden by the table text ' + m.ticker, () => {
      const wrong = m.ticker.endsWith('.SZ') ? '002999.SZ' : '600999.SS';
      assert.equal(Parser.parseText(m.text, m.anchor, { ticker: wrong, tableText: m.table }).reason, 'security-code-not-in-header');
      assert.equal(Parser.parseText(m.text, m.anchor, { ticker: m.ticker, year: 2025, tableText: m.table }).reason, 'report-year-not-in-header');
    });
  }
  t('k2 the next row growth on 002093.SZ is not the revenue growth', () => {
    const m = k2.find(m => m.ticker === '002093.SZ'), p = Parser.parseText(m.text, m.anchor, { ticker: m.ticker, tableText: m.table });
    assert.equal(p.growth.value, -0.57);
    assert.ok(m.text.includes('4.59%') && m.table.split('\n').slice(m.slot.row + 1).some(l => l.includes('4.59%')));
  });
  t('k2 restated prior is cross-checked against the growth', () => {
    const m = k2.find(m => m.ticker === '600718.SS'), line = m.table.split('\n')[m.slot.row];
    // The adjusted (second) prior is checked; the unadjusted one is only stored.
    const at = line.lastIndexOf('2,802,032,034', line.indexOf('-6.03'));
    const changed = m.table.replace(line, line.slice(0, at) + '2,902,032,034' + line.slice(at + 13));
    assert.equal(Parser.parseText(m.text, m.anchor, { ticker: m.ticker, tableText: changed }).tableReason, 'printed-prior-growth-inconsistent');
    const before = m.table.replace(line, line.replace('2,802,032,034', '2,902,032,034'));
    assert.equal(Parser.parseText(m.text, m.anchor, { ticker: m.ticker, tableText: before }).priorValues.before.value, 2902032034);
  });
  t('k2 parsed layout results ignore the table text', () => {
    const m = k2[0];
    assert.deepEqual(Parser.parseText(f.text, f.anchor, { ticker: f.ticker, tableText: m.table }), good);
  });
  return ok;
}
passed += k2Suite(P);
// Break once: binding the first later line with a growth cell instead of the revenue line itself
// must turn the blank-cell probe red for a fixture whose next row carries a growth value.
test('k2 intentional rule break: growth from another table line is detected', () => {
  const file = path.join(__dirname, '../scripts/cn-printed-parser.js'), source = fs.readFileSync(file, 'utf8');
  const from = ['  const between = line.slice(q.end, y.x);', 'const mid = rows[row].filter('];
  for (const s of from) assert.equal(source.split(s).length, 2, 'unique complete code anchor');
  const broken = source.replace(from[0], '  const bindRow = rows.findIndex((r, i) => i >= row && r.some(t => t.x >= q.end && t.end <= y.x));\n  const between = lines[bindRow].slice(q.end, y.x);')
    .replace(from[1], 'const mid = rows[bindRow].filter(');
  const context = { module: { exports: {} } };
  vm.runInNewContext(broken, context, { timeout: 1000 });
  assert.throws(() => k2Suite(context.module.exports), /AssertionError|Expected|equal/);
});
// K2 fetch: the table text is a second cached extraction of the same PDF; its failure is recorded, never fatal.
(async () => {
  const F = require('../scripts/fetch-cn-printed'), H = require('./cn-printed.helpers'), before = H.liveHashes();
  global.fetch = () => { throw Error('NETWORK IS FORBIDDEN IN TESTS'); };
  const ann = { secCode: '002415', announcementTitle: '2026年三季度报告', announcementId: '1225607861',
    adjunctUrl: 'finalpage/2026-10-17/1225607861.PDF', announcementTime: Date.parse('2026-10-16T16:00:00Z') };
  const meta = F.announcementMeta(ann, f.ticker, 2026, '2026-11-12'), dir = H.sandbox(), modes = [];
  const client = { request: async u => u.includes('topSearch') ? [{ code: '002415', orgId: 'one' }]
    : u.includes('hisAnnouncement') ? { announcements: [ann], hasMore: false } : Buffer.from('%PDF-test'), calls: () => 0 };
  const convert = (pdf, temp, mode) => { modes.push(mode); fs.writeFileSync(temp, mode === 'table' ? k2[0].table : f.text); };
  const a = await F.cachedText(client, meta, dir, convert), b = await F.cachedText(client, meta, dir, convert, 'table');
  assert.equal(a.text, f.text); assert.equal(b.text, k2[0].table); assert.deepEqual(modes, ['layout', 'table']);
  assert.ok(fs.existsSync(path.join(dir, meta.announcementId + '.table.txt.success.json')));
  await F.cachedText(client, meta, dir, convert, 'table'); assert.equal(modes.length, 2, 'table text cached');
  await assert.rejects(F.cachedText(client, meta, dir, convert, 'raw'), /extraction-mode-invalid/);
  passed++;
  const env = H.sandbox(), cnStore = path.join(env, 'cn.json'), store = path.join(env, 'cn-printed.json');
  fs.writeFileSync(cnStore, JSON.stringify(H.vendorStore([f])));
  const opts = { cnStore, store, cacheDir: path.join(env, 'cache'), now: () => new Date('2026-11-12T12:00:00Z'), tickers: [f.ticker], cap: 1, client };
  const r = await F.main({ ...opts, convert: (pdf, temp, mode) => { if (mode === 'table') throw Error('table-boom'); fs.writeFileSync(temp, f.text); } });
  const o = JSON.parse(fs.readFileSync(store, 'utf8')).companies[f.ticker].reports[meta.announcementId][0];
  assert.equal(r.parsed, 1); assert.equal(o.tableTextError, 'table-boom'); assert.equal(o.tableTextSha256, undefined);
  assert.deepEqual(o.growth, good.growth, 'the layout result is kept');
  passed++;
  assert.deepEqual(H.liveHashes(), before);
  console.log(`${passed} parser tests passed (60 real text fixtures, ${k2.length} K2 table-line fixtures; no network).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
