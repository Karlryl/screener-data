'use strict';

const offlineGuard = require('./helpers/offline-network-guard');
const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { fetchEdinetJapan } = require('../discovery/edinet-jp');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function csvFixture({ codeHeader = '証券コード', code = '285AA' } = {}) {
  return [
    'download metadata',
    `上場区分,提出者名（英字）,${codeHeader}`,
    `上場,Reserve Letter Corp,${code}`,
    '非上場,Private Corp,999ZZ',
    '',
  ].join('\n');
}

function injectedPipeline(csvText, getImpl) {
  const calls = { get: 0, unzip: 0, decode: 0 };
  const options = {
    get: async (url) => {
      calls.get += 1;
      if (getImpl) return getImpl(url);
      return Buffer.from('synthetic zip');
    },
    unzip: (zip) => {
      calls.unzip += 1;
      assert.equal(zip.toString('utf8'), 'synthetic zip');
      return Buffer.from('synthetic Shift_JIS payload');
    },
    decode: (payload) => {
      calls.decode += 1;
      assert.equal(payload.toString('utf8'), 'synthetic Shift_JIS payload');
      return csvText;
    },
  };
  return { calls, options };
}

test('transport failure stays fail-silent but carries an own partial marker', async () => {
  const pipeline = injectedPipeline(csvFixture(), async () => {
    throw new Error('synthetic transport failure');
  });

  const result = await fetchEdinetJapan(pipeline.options);

  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
  assert.equal(hasOwn(result, 'partial'), true);
  assert.equal(result.partial, true);
  assert.deepEqual(pipeline.calls, { get: 1, unzip: 0, decode: 0 });
});

test('required-header drift returns an own-marked zero result', async () => {
  const pipeline = injectedPipeline(csvFixture({ codeHeader: '証券ID' }));

  const result = await fetchEdinetJapan(pipeline.options);

  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
  assert.equal(hasOwn(result, 'partial'), true);
  assert.equal(result.partial, true);
  assert.deepEqual(pipeline.calls, { get: 1, unzip: 1, decode: 1 });
});

test('healthy pipeline preserves listed rows, fifth-letter codes, and no partial marker', async () => {
  const pipeline = injectedPipeline(csvFixture());

  const result = await fetchEdinetJapan(pipeline.options);

  assert.ok(result instanceof Map);
  assert.equal(result.size, 1, 'the unlisted control row must stay filtered');
  assert.equal(hasOwn(result, 'partial'), false);
  assert.deepEqual([...result.keys()], ['285A.T']);
  assert.deepEqual(result.get('285A.T'), {
    ticker: '285A.T',
    name: 'Reserve Letter Corp',
    exchange: 'TSE',
    source: 'edinet-jp',
    country: 'Japan',
  });
  assert.deepEqual(pipeline.calls, { get: 1, unzip: 1, decode: 1 });
});

after(() => {
  assert.deepEqual(offlineGuard.state.attempts, [], 'all fixtures must stay on injected offline seams');
});
