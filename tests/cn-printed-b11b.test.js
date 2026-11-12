'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const P = require('../scripts/cn-printed-parser');
const H = require('./cn-printed.helpers');
const dir = path.join(__dirname, 'fixtures/cn-printed-b11b');
const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')))
  .map(f => ({ ...f, text: fs.readFileSync(path.join(dir, f.ticker + '.txt'), 'utf8') }));
const before = H.liveHashes();
let passed = 0, negative = 0;
function test(name, fn) { try { fn(); passed++; } catch (e) { e.message = name + ': ' + e.message; throw e; } }
const fixture = ticker => fixtures.find(f => f.ticker === ticker);
const parse = (f, text = f.text, anchor = f.anchor) => P.parseText(text, anchor, { ticker: f.ticker });
function gap(f, text, anchor) {
  const p = parse(f, text, anchor);
  assert.equal(p.parseStatus, 'unparsed');
  for (const key of ['current', 'ytd', 'growth', 'unit', 'priorValues']) assert.equal(p[key], undefined);
  negative++;
}
function replaceLine(text, needle, edit) {
  const lines = text.split('\n'), matching = lines.map((s, i) => s.includes(needle) ? i : -1).filter(i => i >= 0);
  assert.equal(matching.length, 1, 'mutation anchor must identify one complete line');
  const i = matching[0]; lines[i] = edit(lines[i]);
  return lines.join('\n');
}

for (const f of fixtures) test('cached excerpt ' + f.ticker, () => {
  const p = parse(f);
  if (f.expected.reason) { assert.equal(p.reason, f.expected.reason); gap(f, f.text); return; }
  assert.equal(p.parseStatus, 'parsed', p.reason);
  assert.equal(p.growth.value, f.expected.growth);
  assert.equal(p.unit, f.expected.unit);
  assert.equal(p.priorValues?.after.value ?? null, f.expected.prior);
  assert.ok(p.quoteLines.every(q => f.text.split('\n')[q.line - 1] === q.text));
  const c = p.current, y = p.ytd;
  assert.ok(Math.abs(c.value - f.anchor.current) <= c.roundingHalfWidth + 0.001);
  assert.ok(Math.abs(y.value - f.anchor.ytd) <= y.roundingHalfWidth + 0.001);
});
for (const f of fixtures.filter(f => !f.expected.reason)) {
  test('Q3 anchor broken ' + f.ticker, () => gap(f, f.text, { ...f.anchor, current: f.anchor.current * 1.01 }));
  test('9M anchor broken ' + f.ticker, () => gap(f, f.text, { ...f.anchor, ytd: f.anchor.ytd * 1.01 }));
}

test('code must occupy the whole digit run with exact companion lengths', () => {
  const f = fixture('000002.SZ');
  for (const bad of ['1000002299903', '0000022999037', '0000021234', '0000021234567', '900002299903']) {
    gap(f, replaceLine(f.text, '000002299903', l => l.replace('000002299903', bad)));
  }
  const t = H.fixture('002415.SZ');
  const bad = replaceLine(t.text, '002415', l => l.replace('002415', '1600000'));
  assert.equal(P.parseText(bad, t.anchor, { ticker: '600000.SS' }).reason, 'security-code-not-in-header');
  assert.equal(P.parseText(f.text, f.anchor, { ticker: '299903.SZ' }).reason, 'security-code-not-in-header');
  negative += 2;
});
test('split comma group must stay in the same cell and form a valid amount', () => {
  const f = fixture('000543.SZ');
  gap(f, replaceLine(f.text, ',985.86', l => l.replace(',985.86', ',985,86')));
  gap(f, replaceLine(f.text, ',985.86', l => l.replace(',985.86', '       ')));
  gap(f, replaceLine(f.text, '8,889,321', l => l.replace('8,889,321', '8,999,321')));
});
test('million scale cannot match only one of the two revenue anchors', () => {
  const f = fixture('600029.SS');
  gap(f, replaceLine(f.text, '147,212', l => l.replace('147,212', '147,213')));
  gap(f, f.text, { ...f.anchor, ytd: f.anchor.ytd / 1000 });
});
test('standalone percent belongs to the quarter growth column, not only the YTD header', () => {
  for (const ticker of ['000551.SZ', '000601.SZ', '000680.SZ']) {
    const f = fixture(ticker);
    gap(f, f.text.replace(/%/g, ' '));
    const left = ticker === '000680.SZ' ? 72 : 28;
    gap(f, f.text.split('\n').map(l => l.slice(0, left) + l.slice(left, 80).replace(/%/g, ' ') + l.slice(80)).join('\n'));
  }
});
test('shifted profit rows do not license missing revenue growth', () => {
  for (const [ticker, raw] of [['000050.SZ','-5.75%'],['000069.SZ','-24.20%'],['600105.SS','52.56'],['600110.SS','110.07'],['600246.SS','61.88']]) {
    const f = fixture(ticker);
    gap(f, replaceLine(f.text, raw, l => l.replace(raw, '--'.padStart(raw.length))));
  }
});
test('staggered prior columns still require the adjusted prior and both YTD prior cells', () => {
  for (const [ticker, raw] of [['600022.SS','16,539,111,642.54'],['600048.SS','5,686,496.15'],['600062.SS','2,586,650,961.69']]) {
    const f = fixture(ticker);
    // Change every occurrence on the one source line; neither prior is guessed from growth.
    gap(f, replaceLine(f.text, raw, l => l.split(raw).join(raw.replace(/[1-9]/, '9'))));
  }
  const f = fixture('600022.SS');
  gap(f, replaceLine(f.text, '51,194,644,003.25', l => l.replace('51,194,644,003.25', '                ')));
});
test('single prior needs explicit comparative period labels and arithmetic consistency', () => {
  const f = fixture('600100.SS');
  assert.equal(P.comparable(parse(f)).method, 'printed-prior');
  gap(f, replaceLine(f.text, '2025  7-9', l => l.replace('2025  7-9', '2024  7-9')));
  gap(f, replaceLine(f.text, '2025  1-9', l => l.replace('2025  1-9', '2024  1-9')));
  gap(f, replaceLine(f.text, '2,738,398,721.24', l => l.replace('2,738,398,721.24', '2,638,398,721.24')));
});

// Break each recognition rule in MEMORY only. Its real positive fixture must then
// fail. This demonstrates that the positive checks exercise the added rules.
const source = fs.readFileSync(path.join(H.ROOT, 'scripts/cn-printed-parser.js'), 'utf8');
const mutations = [
  ['joined codes', String.raw`(extended ? '(?:\\d{5}|\\d{6}|\\d{11})?' : '')`, "''", '000002.SZ'],
  ['comma continuation', String.raw`(extended ? /^[\d,]+\.\d{2}$/ : /^,?\d+(?:\.\d{2})$/)`, String.raw`(/^,?\d+(?:\.\d{2})$/)`, '000543.SZ'],
  ['million', '[1, 1000, 10000, 1000000]', '[1, 1000, 10000]', '600029.SS'],
  ['prior row bounds', '(extended ? lo : q.row - 1)', '(q.row - 1)', '600022.SS'],
  ['late prior columns', '(extended ? Math.max(q.row, y.row) : q.row + 3)', '(q.row + 3)', '600048.SS'],
  ['profit separation', source.slice(source.indexOf('  const middle ='), source.indexOf('  const firstRow =')),
    '  const middle = amounts.filter(t => t.row >= q.row - 1 && t.row <= q.row + 3 && t.x > q.end && t.end < y.x);\n', '000050.SZ'],
  ['standalone percent', 'const percentHeader = extended &&', 'const percentHeader = false &&', '000601.SZ'],
  ['single prior', 'const singlePrior = extended &&', 'const singlePrior = false &&', '600100.SS']
];
for (const [name, from, to, ticker] of mutations) test('intentional rule break: ' + name, () => {
  assert.equal(source.split(from).length, 2, 'unique complete code anchor');
  const context = { module: { exports: {} } };
  vm.runInNewContext(source.replace(from, to), context, { timeout: 1000 });
  const f = fixture(ticker), broken = context.module.exports.parseText(f.text, f.anchor, { ticker });
  assert.throws(() => assert.equal(broken.parseStatus, 'parsed'));
});
assert.deepEqual(H.liveHashes(), before);
console.log(`${passed} B11b tests passed; ${negative} negative data checks; 8 intentional rule breaks detected; source stores unchanged.`);
