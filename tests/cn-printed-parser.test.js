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
console.log(`${passed} parser tests passed (60 real text fixtures; no network).`);
