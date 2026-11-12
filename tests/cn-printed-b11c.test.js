'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { createRequire } = require('module');
const H = require('./cn-printed.helpers');
const dir = path.join(__dirname, 'fixtures/cn-printed-b11c');
const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')))
  .map(f => ({ ...f, text: fs.readFileSync(path.join(dir, f.file), 'utf8') }));
const parserFile = path.join(H.ROOT, 'scripts/cn-printed-parser.js');
const reportFile = path.join(H.ROOT, 'scripts/cn-printed-shadow-report.js');
function moduleFrom(source, filename) {
  const context = { module: { exports: {} }, require: createRequire(filename), __dirname: path.dirname(filename) };
  vm.runInNewContext(source, context, { timeout: 1000 });
  return context.module.exports;
}
function editGrowth(f, replacement) {
  const lines = f.text.split('\n'), s = f.slot;
  assert.equal(lines[s.row].slice(s.x, s.end), s.raw, 'exact source cell');
  // Keep all subsequent columns in place when the replacement is wider.
  const start = s.end - replacement.length;
  assert.ok(start >= 0 && /^\s*$/.test(lines[s.row].slice(start, s.x)), 'replacement fits the cell');
  lines[s.row] = lines[s.row].slice(0, start) + replacement + lines[s.row].slice(s.end);
  return lines.join('\n');
}
function suite(P, R) {
  const failures = []; let passed = 0;
  const test = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push({ name, message: e.message }); } };
  const parse = (f, text = f.text) => P.parseText(text, f.anchor, { ticker: f.ticker });
  const noProposal = (f, p) => {
    const c = P.compare(p, f.priorAnchor);
    assert.notEqual(c.status, 'agree');
    assert.equal(R.proposal({ candidate: true, asOf: '2026-11-11' }, p, c, '2026-11-11'), null);
  };
  for (const f of fixtures) {
    test('original ' + f.file, () => {
      const p = parse(f); assert.equal(p.parseStatus, f.expected.parseStatus, p.reason);
      if (!f.slot) return;
      assert.equal(p.growth.value, f.expected.growth); assert.equal(p.unit, f.expected.unit);
      assert.equal(p.priorValues?.after.value ?? null, f.expected.prior);
    });
    test('blank growth cell ' + f.file, () => {
      const p = parse(f, f.slot ? editGrowth(f, ' '.repeat(f.slot.raw.length)) : f.text);
      assert.equal(p.parseStatus, 'unparsed', 'a blank revenue cell must not borrow another row');
      noProposal(f, p);
    });
  }
  for (const ticker of ['600278.SS', '000008.SZ']) {
    const f = fixtures.find(f => f.ticker === ticker && f.slot);
    assert.ok(f, 'negative fixture exists');
    const magnitude = f.slot.raw.replace(/^-/, '');
    for (const [name, replacement] of [
      ['unicode minus', '\u2212' + magnitude], ['en dash', '\u2013' + magnitude], ['figure dash', '\u2012' + magnitude],
      ['accounting negative', '(' + magnitude.replace('%', '') + ')' + (magnitude.endsWith('%') ? '%' : '')],
      ['fullwidth accounting negative', '（' + magnitude.replace('%', '') + '）' + (magnitude.endsWith('%') ? '%' : '')]
    ]) test(name + ' ' + ticker, () => {
      const p = parse(f, editGrowth(f, replacement));
      if (p.parseStatus === 'parsed') assert.equal(p.growth.value, f.expected.growth, 'negative sign preserved');
      else assert.equal(p.reason, 'growth-token-sign-unknown');
    });
    for (const replacement of ['字' + f.slot.raw, 'x' + f.slot.raw, f.slot.raw + 'x', '-' + '字' + magnitude]) {
      test('token boundary ' + ticker + ' ' + replacement, () => {
        const p = parse(f, editGrowth(f, replacement));
        assert.equal(p.parseStatus, 'unparsed'); noProposal(f, p);
      });
    }
  }
  test('printed-only never proposes a fill', () => {
    const f = H.fixture('002415.SZ'), p = P.parseText(f.text, f.anchor, { ticker: f.ticker });
    const snapshot = { meta: { ticker: f.ticker, reportingCurrency: 'CNY', asOf: '2026-11-11' },
      timeseries: { revenueQEnds: ['2026-09-30'], revenueQ: [{ value: f.anchor.current }] } };
    const info = R.snapshotInfo(snapshot, { date: null, rows: new Map() }, 2026);
    assert.equal(R.proposal(info, { ...p, periodEnd: '2026-09-30', noticeDate: '2026-10-30' }, P.compare(p, null), '2026-11-11'), null);
  });
  test('visible row labels must agree with the revenue slot', () => {
    const f = fixtures.find(f => f.ticker === '600278.SS' && f.slot), p = parse(f);
    const lines = f.text.split('\n'), q = lines.findIndex(l => l.includes(p.current.printed));
    assert.ok(q >= 0 && /^ {4}/.test(lines[q]) && /^ {4}/.test(lines[f.slot.row]));
    lines[q] = '营业收入' + lines[q].slice(4);
    assert.equal(parse(f, lines.join('\n')).parseStatus, 'parsed');
    lines[f.slot.row] = '利润总额' + lines[f.slot.row].slice(4);
    assert.equal(parse(f, lines.join('\n')).reason, 'growth-row-unbound');
  });
  test('row recognition does not match financial values', () => {
    const f = fixtures.find(f => f.ticker === '600278.SS' && f.slot);
    assert.equal(parse(f, f.text.replace('87,843,378.99', '97,843,378.99')).growth.value, -9.24);
    assert.equal(parse(f, editGrowth(f, '-19.24')).growth.value, -19.24);
  });
  for (const [ticker, raw] of [['000552.SZ', '2,436,103,114.55'], ['000713.SZ', '376,174,603.97'],
    ['000877.SZ', '18,958,088,111.21'], ['000878.SZ', '47,293,219,860.97'],
    ['000900.SZ', '1,338,967,902.92'], ['600188.SS', '38,603,818'], ['600252.SS', '413,934,645.91']]) {
    test('late printed prior cross-check ' + ticker, () => {
      const f = fixtures.find(f => f.ticker === ticker && f.slot);
      assert.ok(f, 'late prior fixture exists');
      const lines = f.text.split('\n');
      let prefix = raw;
      while (prefix.length > 8 && !lines.some(l => l.includes(prefix))) prefix = prefix.slice(0, -1);
      const matching = lines.map((l, i) => l.includes(prefix) ? i : -1).filter(i => i >= 0);
      assert.equal(matching.length, 1, 'one complete source line');
      lines[matching[0]] = lines[matching[0]].split(prefix).join(prefix.replace(/[1-8]/, '9'));
      assert.equal(parse(f, lines.join('\n')).reason, 'printed-prior-growth-inconsistent');
    });
  }
  return { passed, failed: failures.length, failures };
}
if (require.main === module) {
  const before = H.liveHashes();
  const P = require(process.env.B11C_PARSER || parserFile);
  const R = process.env.B11C_REPORT ? moduleFrom(fs.readFileSync(process.env.B11C_REPORT, 'utf8'), reportFile) : require(reportFile);
  const result = suite(P, R);
  assert.deepEqual(H.liveHashes(), before);
  if (process.env.B11C_RESULTS) fs.writeFileSync(process.env.B11C_RESULTS, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: result.passed, failed: result.failed, firstFailures: result.failures.slice(0, 5) }));
  process.exitCode = result.failed ? 1 : 0;
}
module.exports = { suite, moduleFrom, editGrowth, fixtures };
