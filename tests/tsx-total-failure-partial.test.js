'use strict';

require('./helpers/offline-network-guard');

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchTsxCanada } = require('../discovery/tsx-ca');

const OFFLINE_STATE = Symbol.for('screener.offlineNetworkGuard');

function inlineCell(ref, value) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function sheet(exchange, ticker, name) {
  return Buffer.from([
    '<worksheet><sheetData>',
    '<row r="1">',
    inlineCell('A1', 'Exchange'),
    inlineCell('B1', 'Name'),
    inlineCell('C1', 'Root Ticker'),
    '</row>',
    '<row r="2">',
    inlineCell('A2', exchange),
    inlineCell('B2', name),
    inlineCell('C2', ticker),
    '</row>',
    '</sheetData></worksheet>',
  ].join(''), 'utf8');
}

function healthyEntries() {
  return {
    'xl/worksheets/sheet1.xml': sheet('TSX', 'ALPHA', 'Alpha Operating Inc.'),
    'xl/worksheets/sheet2.xml': sheet('TSXV', 'BETA', 'Beta Operating Inc.'),
  };
}

const quietLog = () => {};

test('offline guard is installed before the TSX adapter is loaded', () => {
  assert.ok(globalThis[OFFLINE_STATE]);
});

test('a transport rejection returns an empty Map marked partial', async () => {
  const result = await fetchTsxCanada({
    get: async () => { throw new Error('fixture transport failure'); },
    readZipEntries: () => { throw new Error('must not reach ZIP reader'); },
    log: quietLog,
  });

  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
  assert.equal(Object.hasOwn(result, 'partial'), true);
  assert.equal(result.partial, true);
});

test('a ZIP reader failure returns an empty Map marked partial', async () => {
  const result = await fetchTsxCanada({
    get: async () => Buffer.from('synthetic XLSX fixture'),
    readZipEntries: () => { throw new Error('fixture ZIP failure'); },
    log: quietLog,
  });

  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
  assert.equal(Object.hasOwn(result, 'partial'), true);
  assert.equal(result.partial, true);
});

test('a failure after sheet 1 still preserves the all-or-nothing empty result', async () => {
  const entries = healthyEntries();
  entries['xl/worksheets/sheet2.xml'] = {
    toString() { throw new Error('fixture sheet 2 parse failure'); },
  };

  const result = await fetchTsxCanada({
    get: async () => Buffer.from('synthetic XLSX fixture'),
    readZipEntries: () => entries,
    log: quietLog,
  });

  assert.ok(result instanceof Map);
  assert.equal(result.size, 0, 'partial rows must not leak from the existing all-or-nothing catch');
  assert.equal(Object.hasOwn(result, 'partial'), true);
  assert.equal(result.partial, true);
});

test('a healthy two-sheet register emits both venues without a partial marker', async () => {
  let getCalls = 0;
  let readCalls = 0;
  const result = await fetchTsxCanada({
    get: async () => { getCalls++; return Buffer.from('synthetic XLSX fixture'); },
    readZipEntries: () => { readCalls++; return healthyEntries(); },
    log: quietLog,
  });

  assert.equal(getCalls, 1);
  assert.equal(readCalls, 1);
  assert.deepEqual([...result.keys()], ['ALPHA.TO', 'BETA.V']);
  assert.equal(result.get('ALPHA.TO').exchange, 'TSX');
  assert.equal(result.get('BETA.V').exchange, 'TSXV');
  assert.equal(Object.hasOwn(result, 'partial'), false);
});
