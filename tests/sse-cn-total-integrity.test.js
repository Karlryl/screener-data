#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { fetchSseUniverse } = require('../discovery/sse-cn.js');

const OMIT_TOTAL = Symbol('omit-total');
const ROOT = path.join(__dirname, '..');
const MEASUREMENT = path.join(ROOT, 'scripts', 'messung-entdeckungsband.js');

function row(code, overrides = {}) {
  return {
    A_STOCK_CODE: code,
    FULL_NAME_IN_ENGLISH: `Company ${code}`,
    LIST_DATE: '20200102',
    DELIST_DATE: '-',
    ...overrides
  };
}

function payload(rows, total = OMIT_TOTAL, options = {}) {
  const out = {};
  if (options.result !== false) out.result = rows;
  if (options.pageHelp !== false) {
    out.pageHelp = { data: rows };
    if (total !== OMIT_TOTAL) out.pageHelp.total = total;
  }
  return out;
}

async function runFixture(json) {
  const originalGet = https.get;
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  const messages = { log: [], warn: [], error: [] };
  let calls = 0;

  https.get = (url, options, callback) => {
    calls++;
    assert.match(String(url), /pageHelp\.pageSize=5000/);
    assert.equal(options.headers.Referer, 'https://www.sse.com.cn/');

    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => {};

    process.nextTick(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      response.resume = () => {};
      callback(response);
      process.nextTick(() => {
        response.emit('data', Buffer.from(JSON.stringify(json), 'utf8'));
        response.emit('end');
      });
    });

    return request;
  };
  console.log = (...args) => messages.log.push(args.join(' '));
  console.warn = (...args) => messages.warn.push(args.join(' '));
  console.error = (...args) => messages.error.push(args.join(' '));

  let result;
  try {
    result = await fetchSseUniverse();
  } finally {
    https.get = originalGet;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  assert.equal(calls, 1, 'each fixture must exercise exactly one production request');
  assert.equal(https.get, originalGet, 'https.get must be restored');
  assert.equal(console.log, originalConsole.log, 'console.log must be restored');
  assert.equal(console.warn, originalConsole.warn, 'console.warn must be restored');
  assert.equal(console.error, originalConsole.error, 'console.error must be restored');
  return { result, messages };
}

test('an exact safe-integer total certifies completeness', async () => {
  const rows = [row('600001'), row('688001')];
  const { result, messages } = await runFixture(payload(rows, 2));

  assert.deepEqual([...result.keys()], ['600001.SS', '688001.SS']);
  assert.notEqual(result.partial, true);
  assert.equal(result.partialReason, undefined);
  assert.deepEqual(messages.warn, []);
});

test('a genuine zero-row response with total zero remains complete', async () => {
  const { result, messages } = await runFixture(payload([], 0));

  assert.equal(result.size, 0);
  assert.notEqual(result.partial, true);
  assert.equal(result.partialReason, undefined);
  assert.deepEqual(messages.warn, []);
});

test('a valid larger total is proven range truncation', async () => {
  const rows = [row('600001'), row('688001')];
  const { result, messages } = await runFixture(payload(rows, 3));

  assert.equal(result.size, 2);
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, 'range-truncated');
  assert.equal(messages.warn.length, 1);
  assert.match(messages.warn[0], /got 2 rows.*total=3.*PARTIAL/);
  assert.match(messages.warn[0], /raise pageHelp\.pageSize/,
    'only proven range truncation should recommend increasing the page size');
});

test('a valid smaller total is inconsistent and cannot certify completeness', async () => {
  const rows = [row('600001'), row('688001')];
  const { result, messages } = await runFixture(payload(rows, 1));

  assert.deepEqual([...result.keys()], ['600001.SS', '688001.SS'],
    'delivered rows must survive an inconsistent total');
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, 'total-count-smaller-than-data');
  assert.equal(messages.warn.length, 1);
  assert.match(messages.warn[0], /got 2 rows.*total=1.*inconsistent.*PARTIAL/i);
  assert.doesNotMatch(messages.warn[0], /raise pageHelp\.pageSize/,
    'an inconsistent smaller total does not prove range truncation');
});

test('missing and malformed totals fail closed without discarding rows', async t => {
  const cases = [
    ['missing field', OMIT_TOTAL],
    ['null', null],
    ['numeric string', '2'],
    ['junk string', 'not-a-count'],
    ['negative', -1],
    ['fractional', 2.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['negative unsafe integer', -(Number.MAX_SAFE_INTEGER + 1)],
    ['boolean', true],
    ['object', {}],
    ['array', []]
  ];

  for (const [label, total] of cases) {
    await t.test(label, async () => {
      const rows = [row('600001'), row('688001')];
      const { result, messages } = await runFixture(payload(rows, total));

      assert.deepEqual([...result.keys()], ['600001.SS', '688001.SS']);
      assert.equal(result.partial, true);
      assert.equal(result.partialReason, 'invalid-total-count');
      assert.equal(messages.warn.length, 1);
      assert.match(messages.warn[0], /pageHelp\.total.*invalid.*UNVERIFIABLE.*PARTIAL/i);
      const shown = total === OMIT_TOTAL ? 'missing' : JSON.stringify(total);
      assert.ok(messages.warn[0].includes(`(${shown})`),
        `warning must preserve the received total evidence: ${shown}`);
      assert.doesNotMatch(messages.warn[0], /raise pageHelp\.pageSize/,
        'invalid metadata does not prove range truncation');
    });
  }
});

test('an inherited total cannot certify completeness', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'total');
  Object.defineProperty(Object.prototype, 'total', {
    configurable: true,
    value: 2
  });

  try {
    const rows = [row('600001'), row('688001')];
    const { result, messages } = await runFixture(payload(rows));

    assert.deepEqual([...result.keys()], ['600001.SS', '688001.SS']);
    assert.equal(result.partial, true);
    assert.equal(result.partialReason, 'invalid-total-count');
    assert.equal(messages.warn.length, 1);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(Object.prototype, 'total', originalDescriptor);
    } else {
      delete Object.prototype.total;
    }
  }

  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'total'), originalDescriptor,
    'Object.prototype.total must be restored exactly');
});

test('a missing pageHelp object also marks a silent empty result partial', async () => {
  const { result, messages } = await runFixture(payload([], OMIT_TOTAL, { pageHelp: false }));

  assert.equal(result.size, 0);
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, 'invalid-total-count');
  assert.equal(messages.warn.length, 1);
});

test('the pageHelp.data fallback uses the same total integrity contract', async () => {
  const rows = [row('600001')];
  const { result, messages } = await runFixture(payload(rows, 1, { result: false }));

  assert.deepEqual([...result.keys()], ['600001.SS']);
  assert.notEqual(result.partial, true);
  assert.equal(result.partialReason, undefined);
  assert.deepEqual(messages.warn, []);
});

test('transport completeness is based on raw rows, not filtered Map size', async () => {
  const rows = [
    row('600001'),
    row('600001', { FULL_NAME_IN_ENGLISH: 'Duplicate' }),
    row('600002', { DELIST_DATE: '20240101' }),
    null,
    false,
    0,
    '',
    {}
  ];
  const { result, messages } = await runFixture(payload(rows, 8));

  assert.deepEqual([...result.keys()], ['600001.SS']);
  assert.notEqual(result.partial, true,
    'duplicates and delisted rows are local filtering, not transport truncation');
  assert.equal(result.partialReason, undefined);
  assert.deepEqual(messages.warn, []);
});

test('measurement plumbing keeps proven lower bounds separate from open direction', () => {
  const helperProbe = `
    const m = require(process.argv[1]);
    const status = m.classifyRegisterCompleteness({
      healthy: { partial: false },
      legacy: { partial: true },
      emptyReason: { partial: true, partialReason: '' },
      truthyOnly: { partial: 'yes', partialReason: 'range-truncated' },
      range: { partial: true, partialReason: 'range-truncated' },
      invalid: { partial: true, partialReason: 'invalid-total-count' },
      smaller: { partial: true, partialReason: 'total-count-smaller-than-data' }
    });
    const sourceMap = new Map([['600001.SS', {}], ['688001.SS', {}]]);
    sourceMap.partial = true;
    sourceMap.partialReason = 'invalid-total-count';
    const snapshot = m.serializeRegisterSnapshot('CN', sourceMap);
    const truthyMap = new Map([['600002.SS', {}]]);
    truthyMap.partial = 'yes';
    truthyMap.partialReason = 'range-truncated';
    const truthySnapshot = m.serializeRegisterSnapshot('CN', truthyMap);
    const enriched = m.addRegisterCompletenessToResult({ marker: 'kept',
      unvollstaendigeRegister: ['stale'] }, {
      range: { partial: true, partialReason: 'range-truncated' },
      legacy: { partial: true }
    });
    const reportLines = ['sentinel'];
    const appended = m.appendRegisterCompletenessWarnings(reportLines, enriched);
    process.stdout.write('###' + JSON.stringify({
      status,
      snapshot,
      statusLine: m.formatRegisterStatusLine('sse', snapshot),
      truthySnapshot,
      enriched,
      reportLines,
      appended,
      notices: [
        m.formatRegisterPartialNotice(false, null),
        m.formatRegisterPartialNotice(true, null),
        m.formatRegisterPartialNotice(true, ''),
        m.formatRegisterPartialNotice(true, 'range-truncated'),
        m.formatRegisterPartialNotice(true, 'invalid-total-count')
      ],
      warnings: m.buildRegisterCompletenessWarnings(status),
      legacyWarnings: m.buildRegisterCompletenessWarnings({})
    }));`;
  const probe = spawnSync(process.execPath, ['-e', helperProbe, MEASUREMENT], {
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(probe.status, 0,
    'measurement helpers must be importable without running a stage: ' + (probe.stderr || probe.stdout));
  const marker = String(probe.stdout).indexOf('###');
  assert.ok(marker >= 0, 'measurement helper probe returned no payload');
  const out = JSON.parse(String(probe.stdout).slice(marker + 3));

  assert.deepEqual(out.status.unvollstaendigeRegister,
    ['range (range-truncated)']);
  assert.deepEqual(out.status.unverifizierbareRegister,
    ['legacy', 'emptyReason', 'invalid (invalid-total-count)',
      'smaller (total-count-smaller-than-data)']);
  assert.deepEqual(out.snapshot, {
    land: 'CN',
    tickers: ['600001.SS', '688001.SS'],
    partial: true,
    partialReason: 'invalid-total-count'
  });
  assert.match(out.statusLine,
    /^  sse\s+2 Ticker \(VOLLSTAENDIGKEIT UNVERIFIZIERBAR: invalid-total-count\)$/);
  assert.deepEqual(out.truthySnapshot, {
    land: 'CN', tickers: ['600002.SS'], partial: false, partialReason: null
  }, 'truthy non-boolean partial metadata must not become a production warning');
  assert.deepEqual(out.enriched, {
    marker: 'kept',
    unvollstaendigeRegister: ['range (range-truncated)'],
    unverifizierbareRegister: ['legacy']
  });
  assert.equal(out.appended, 2);
  assert.equal(out.reportLines[0], 'sentinel');
  assert.match(out.reportLines[1], /range \(range-truncated\).*Untergrenze/);
  assert.match(out.reportLines[2], /legacy.*Richtung offen/);
  assert.deepEqual(out.notices, [
    '',
    ' (VOLLSTAENDIGKEIT NICHT BELEGT)',
    ' (VOLLSTAENDIGKEIT NICHT BELEGT)',
    ' (ABGESCHNITTEN)',
    ' (VOLLSTAENDIGKEIT UNVERIFIZIERBAR: invalid-total-count)'
  ]);
  assert.equal(out.warnings.length, 2);
  assert.match(out.warnings[0], /range \(range-truncated\).*Untergrenze/);
  assert.doesNotMatch(out.warnings[0], /legacy|emptyReason/);
  assert.match(out.warnings[1], /legacy, emptyReason, invalid \(invalid-total-count\).*Richtung offen/);
  assert.match(out.warnings[1], /smaller \(total-count-smaller-than-data\)/);
  assert.doesNotMatch(out.warnings[1], /Untergrenze/);
  assert.deepEqual(out.legacyWarnings, [], 'older healthy result files remain readable');

  const source = fs.readFileSync(MEASUREMENT, 'utf8');
  assert.match(source, /je\[name\] = serializeRegisterSnapshot\(land, m\);\s*console\.log\(formatRegisterStatusLine\(name, je\[name\]\)\);/,
    'the tested serializer and complete status line must feed the register stage');
  assert.match(source, /const ergebnis = addRegisterCompletenessToResult\(\{[\s\S]*?\}, reg\);\s*schreib\('ergebnis', ergebnis\);/,
    'the tested completeness enrichment must be the final result before persistence');
  assert.match(source, /appendRegisterCompletenessWarnings\(z, e\);\s*for \(const a of e\.registerAusfaelle\)/,
    'the tested report append must survive into the final report lines');
  assert.match(source, /if \(require\.main === module\)/,
    'importing helpers must not execute an expensive measurement stage');

  const cli = spawnSync(process.execPath, [MEASUREMENT], { encoding: 'utf8', timeout: 10000 });
  assert.equal(cli.status, 2, 'the established missing-stage CLI contract must remain exit 2');
  assert.match(String(cli.stderr) + String(cli.stdout), /Stufe fehlt/);
});
