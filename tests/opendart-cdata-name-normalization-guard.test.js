'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCorpCodeXml } = require('../discovery/opendart-kr.js');

const xml = [
  '<result>',
  '<list>',
  '<corp_code>00999999</corp_code>',
  '<corp_name><![CDATA[Eco Pro BM]]></corp_name>',
  '<stock_code>247540</stock_code>',
  '</list>',
  '<list>',
  '<corp_code>00126380</corp_code>',
  '<corp_name>Samsung Electronics</corp_name>',
  '<stock_code>005930</stock_code>',
  '</list>',
  '</result>',
].join('');

const result = parseCorpCodeXml(xml);

test('OpenDART CDATA wrappers are removed from issuer names', () => {
  assert.equal(result.get('247540.KS')?.name, 'Eco Pro BM');
});

test('plain OpenDART names remain an unchanged parser control', () => {
  assert.equal(result.get('005930.KS')?.name, 'Samsung Electronics');
  assert.equal(result.size, 2);
});
