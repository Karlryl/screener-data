#!/usr/bin/env node
'use strict';

// HARDENING-H17: an empty OTC page is a valid terminator only when it does
// not contradict a reported total. All responses are injected JSON fixtures;
// this test never opens a socket or reads repository/generated data.

const assert = require('node:assert/strict');
const https = require('node:https');
const test = require('node:test');

const originalHttpsGet = https.get;
let networkTripwireHits = 0;
https.get = () => {
  networkTripwireHits++;
  throw new Error('H17_NETWORK_TRIPWIRE');
};

const { fetchOTCMarkets } = require('../discovery/otc-markets.js');

const OMIT_TOTAL = Symbol('omit-total');

function payload(rows, totalRecords = OMIT_TOTAL) {
  const stocks = { rows };
  if (totalRecords !== OMIT_TOTAL) stocks.totalRecords = totalRecords;
  return { stocks };
}

function topLevelPayload(rows, totalRecords = OMIT_TOTAL) {
  const result = { rows };
  if (totalRecords !== OMIT_TOTAL) result.totalRecords = totalRecords;
  return result;
}

function row(symbol) {
  return {
    symbol,
    companyName: `${symbol} Company`,
    marketTier: 'OTCQX',
  };
}

function routedPages(pages) {
  const calls = [];
  return {
    calls,
    async holen(url) {
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get('page'));
      calls.push({ page, url });
      const response = Object.prototype.hasOwnProperty.call(pages, page)
        ? pages[page]
        : payload([]);
      if (response instanceof Error) throw response;
      return JSON.stringify(response);
    },
  };
}

async function captureConsole(fn) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const captured = { log: [], warn: [], error: [] };
  console.log = (...args) => captured.log.push(args.map(String).join(' '));
  console.warn = (...args) => captured.warn.push(args.map(String).join(' '));
  console.error = (...args) => captured.error.push(args.map(String).join(' '));
  try {
    return { value: await fn(), captured };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

async function exercise(pages, extraOpts = {}) {
  const route = routedPages(pages);
  const sleeps = [];
  const networkHitsBefore = networkTripwireHits;
  const run = await captureConsole(() => fetchOTCMarkets({
    ...extraOpts,
    holen: route.holen,
    schlafen: async (ms) => { sleeps.push(ms); },
  }));
  assert.equal(networkTripwireHits, networkHitsBefore,
    'adapter bypassed opts.holen and attempted a real HTTPS request');
  return { result: run.value, captured: run.captured, calls: route.calls, sleeps };
}

function assertComplete(result) {
  assert.equal(Boolean(result.partial), false, 'complete pagination was marked partial');
}

function assertPaginationWarning(captured, page, observed, total) {
  const warnings = captured.warn.join('\n');
  assert.match(warnings, new RegExp(`page\\s*${page}`, 'i'),
    `warning does not identify page ${page}:\n${warnings}`);
  assert.match(warnings, new RegExp(`${observed}\\s*(?:/|of)\\s*${total}`, 'i'),
    `warning does not report observed/total ${observed}/${total}:\n${warnings}`);
}

function assertObservedTotalWarning(captured, observed, total) {
  const warnings = captured.warn.join('\n');
  const relation = new RegExp(
    `(?:${observed}\\s*(?:/|of)\\s*${total}|(?:observed|received|fetched|delivered)\\D*${observed}\\D+(?:reported|totalRecords|total)\\D*${total})`,
    'i');
  assert.match(warnings, relation,
    `warning does not report observed/total ${observed}/${total}:\n${warnings}`);
}

function pagesOfOne(count, totalRecords = OMIT_TOTAL) {
  const pages = {};
  for (let page = 1; page <= count; page++) {
    pages[page] = payload([row(`A${String(page).padStart(2, '0')}`)], totalRecords);
  }
  return pages;
}

test('OTC pagination integrity is fail-closed without breaking legacy empty responses', async (t) => {
  t.after(() => { https.get = originalHttpsGet; });

  await t.test('HTTPS tripwire is installed before the adapter and must fire', () => {
    const before = networkTripwireHits;
    assert.throws(() => https.get('https://network-tripwire.invalid/'), /H17_NETWORK_TRIPWIRE/);
    assert.equal(networkTripwireHits, before + 1, 'network tripwire control did not fire');
  });

  await t.test('page 1 empty with reported total 1 is partial', async () => {
    const x = await exercise({ 1: payload([], 1) });

    assert.equal(x.result.size, 0);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 1);
    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.deepEqual(x.sleeps, []);
    assertPaginationWarning(x.captured, 1, 0, 1);
  });

  await t.test('empty page 2 retains page 1 but marks reported total 2 partial', async () => {
    const x = await exercise({
      1: payload([row('AAA')], 2),
      2: payload([], 2),
    });

    assert.equal(x.result.size, 1);
    assert.equal(x.result.has('AAA'), true);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 2);
    assert.deepEqual(x.calls.map((call) => call.page), [1, 2]);
    assert.equal(x.sleeps.length, 1, 'injected sleep seam was not used between pages');
    assertPaginationWarning(x.captured, 2, 1, 2);
  });

  await t.test('three one-row pages reach total 3 without PAGE_SIZE offset inflation', async () => {
    const x = await exercise({
      1: payload([row('AAA')], 3),
      2: payload([row('BBB')], 3),
      3: payload([row('CCC')], 3),
    });

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3]);
    assert.equal(x.sleeps.length, 2, 'injected sleep seam was not used between all pages');
    assert.equal(x.result.size, 3);
    assert.deepEqual([...x.result.keys()].sort(), ['AAA', 'BBB', 'CCC']);
    assertComplete(x.result);
  });

  await t.test('healthy one-row total 1 response remains complete', async () => {
    const x = await exercise({ 1: payload([row('AAA')], 1) });

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.equal(x.result.size, 1);
    assertComplete(x.result);
    assert.deepEqual(x.captured.warn, []);
  });

  await t.test('empty response with explicit total 0 remains complete', async () => {
    const x = await exercise({ 1: payload([], 0) });

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.equal(x.result.size, 0);
    assertComplete(x.result);
    assert.deepEqual(x.captured.warn, []);
  });

  await t.test('legacy empty response with unknown total remains complete', async () => {
    const x = await exercise({ 1: payload([]) });

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.equal(x.result.size, 0);
    assertComplete(x.result);
    assert.deepEqual(x.captured.warn, []);
  });

  await t.test('canonical numeric-string total normalizes and completes across pages', async () => {
    const x = await exercise({
      1: payload([row('AAA')], '2'),
      2: payload([row('BBB')], 2),
    });

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2]);
    assert.deepEqual(x.sleeps, [500]);
    assert.deepEqual([...x.result.keys()].sort(), ['AAA', 'BBB']);
    assertComplete(x.result);
    assert.deepEqual(x.captured.warn, []);
    assert.deepEqual(x.captured.error, []);
  });

  await t.test('canonical numeric-string total is stored as a number on a shortfall', async () => {
    const x = await exercise({ 1: payload([], '1') });

    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 1);
    assert.equal(typeof x.result.totalRecords, 'number');
    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assertPaginationWarning(x.captured, 1, 0, 1);
  });

  const invalidTotals = [
    ['negative number', -1],
    ['fractional number', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['boolean', true],
    ['object', {}],
    ['junk string', 'junk'],
    ['noncanonical numeric string', '01'],
    ['unsafe integer string', '9007199254740992'],
  ];

  for (const [label, invalidTotal] of invalidTotals) {
    await t.test(`invalid totalRecords becomes a rejected page failure: ${label}`, async () => {
      const x = await exercise({ 1: payload([row('BAD')], invalidTotal) });
      const errors = x.captured.error.join('\n');

      assert.deepEqual(x.calls.map((call) => call.page), [1, 2]);
      assert.deepEqual(x.sleeps, [500]);
      assert.equal(x.result.size, 0, 'row from invalid-metadata page was accepted');
      assert.equal(x.result.has('BAD'), false);
      assert.equal(x.result.partial, true);
      assert.equal(Object.prototype.hasOwnProperty.call(x.result, 'totalRecords'), false,
        'invalid totalRecords leaked onto the partial result');
      assert.match(errors, /Page\s*1\s+failed/i);
      assert.match(errors, /totalRecords/i);
    });
  }

  await t.test('page error does not inflate the raw offset of later short pages', async () => {
    const x = await exercise({
      1: new Error('synthetic non-timeout page failure'),
      2: payload([row('AAA')], 2),
      3: payload([row('BBB')], 2),
    });

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3]);
    assert.deepEqual(x.sleeps, [500, 500]);
    assert.deepEqual([...x.result.keys()].sort(), ['AAA', 'BBB']);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 2);
    assert.match(x.captured.error.join('\n'), /Page\s*1\s+failed/i);
  });

  await t.test('duplicate and filtered rows still count toward raw delivery completion', async () => {
    const x = await exercise({
      1: payload([row('AAA'), row('AAA'), row('TOOLONG')], 3),
    });

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.deepEqual(x.sleeps, []);
    assert.deepEqual([...x.result.keys()], ['AAA']);
    assertComplete(x.result);
    assert.deepEqual(x.captured.warn, []);
  });

  await t.test('early empty page with total above 5000 warns shortfall, not MAX_PAGES', async () => {
    const x = await exercise({ 1: payload([], 5001) });
    const warnings = x.captured.warn.join('\n');

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.deepEqual(x.sleeps, []);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 5001);
    assertPaginationWarning(x.captured, 1, 0, 5001);
    assert.doesNotMatch(warnings, /HIT MAX_PAGES/i,
      `early empty termination was misreported as exhausting the page cap:\n${warnings}`);
  });

  await t.test('a total first reported below already delivered rows is partial', async () => {
    const x = await exercise({
      1: payload([row('AAA')]),
      2: payload([], 0),
    });

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2]);
    assert.deepEqual(x.sleeps, [500]);
    assert.deepEqual([...x.result.keys()], ['AAA']);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 0);
    assertObservedTotalWarning(x.captured, 1, 0);
    assert.doesNotMatch(x.captured.warn.join('\n'), /HIT MAX_PAGES/i);
  });

  await t.test('ten short pages with known remaining row hit the cap exactly', async () => {
    const x = await exercise(pagesOfOne(10, 11));
    const warnings = x.captured.warn.join('\n');

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(x.sleeps, Array(9).fill(500));
    assert.equal(x.result.size, 10);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 11);
    assert.match(warnings, /HIT MAX_PAGES/i);
    assertObservedTotalWarning(x.captured, 10, 11);
  });

  await t.test('ten nonempty pages with unknown total hit the cap as partial', async () => {
    const x = await exercise(pagesOfOne(10));
    const warnings = x.captured.warn.join('\n');

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(x.sleeps, Array(9).fill(500));
    assert.equal(x.result.size, 10);
    assert.equal(x.result.partial, true);
    assert.equal(Object.prototype.hasOwnProperty.call(x.result, 'totalRecords'), false);
    assert.match(warnings, /HIT MAX_PAGES/i);
  });

  await t.test('exact completion on page 10 is complete and not a cap hit', async () => {
    const x = await exercise(pagesOfOne(10, 10));
    const warnings = x.captured.warn.join('\n');

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(x.sleeps, Array(9).fill(500));
    assert.equal(x.result.size, 10);
    assertComplete(x.result);
    assert.doesNotMatch(warnings, /HIT MAX_PAGES/i);
  });

  const excessTotals = [
    ['two rows over reported one', [row('AAA'), row('BBB')], 1, 1],
    ['one row over reported numeric zero', [row('AAA')], 0, 0],
    ['one row over reported string zero', [row('AAA')], '0', 0],
  ];

  for (const [label, rows, reported, normalized] of excessTotals) {
    await t.test(`delivered rows exceeding totalRecords are partial: ${label}`, async () => {
      const x = await exercise({ 1: payload(rows, reported) });
      const warnings = x.captured.warn.join('\n');

      assert.deepEqual(x.calls.map((call) => call.page), [1]);
      assert.deepEqual(x.sleeps, []);
      assert.equal(x.result.size, rows.length);
      assert.equal(x.result.partial, true);
      assert.equal(x.result.totalRecords, normalized);
      assert.equal(typeof x.result.totalRecords, 'number');
      assert.match(warnings, /mismatch|exceed|reported/i);
      assertObservedTotalWarning(x.captured, rows.length, normalized);
      assert.doesNotMatch(warnings, /HIT MAX_PAGES/i);
    });
  }

  await t.test('later totalRecords drift is partial while valid rows are retained', async () => {
    const x = await exercise({
      1: payload([row('AAA')], 2),
      2: payload([row('DRIFT')], 3),
      3: payload([row('CCC')], 2),
    });
    const diagnostics = [...x.captured.error, ...x.captured.warn].join('\n');

    assert.equal(x.result.has('AAA'), true);
    assert.equal(x.result.has('DRIFT'), true, 'valid row from drifting-total page was discarded');
    assert.equal(x.result.has('CCC'), true, 'pagination stopped before the post-drift page');
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 3, 'conservative maximum total was not retained');
    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3]);
    assert.deepEqual(x.sleeps, [500, 500]);
    assert.match(diagnostics, /totalRecords/i);
    assert.match(diagnostics, /drift|changed|mismatch/i);
  });

  await t.test('repeated identical reported total after drift does not repeat the drift warning', async () => {
    const x = await exercise({
      1: payload([row('AAA')], 10),
      2: payload([row('BBB')], 8),
      3: payload([], 8),
    });
    const driftWarnings = x.captured.warn.filter((line) => /totalRecords drift/i.test(line));

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2, 3]);
    assert.deepEqual([...x.result.keys()].sort(), ['AAA', 'BBB']);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 10);
    assert.equal(driftWarnings.length, 1, `repeated stale drift warning:\n${driftWarnings.join('\n')}`);
    assert.match(driftWarnings[0], /changed from 10 to 8/i);
  });

  await t.test('known total survives a hermetic budget break as partial metadata', async () => {
    let budgetChecks = 0;
    const budget = {
      name: 'OTC-H17-fixture',
      budgetMs: 1000,
      erschoepft() { return budgetChecks++ > 0; },
      restMs() { return 0; },
      verbrauchtMs() { return 1000; },
    };
    const x = await exercise({ 1: payload([row('AAA')], 2) }, { budget });

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.deepEqual(x.sleeps, [500]);
    assert.equal(x.result.has('AAA'), true);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.budgetRiss, true);
    assert.equal(x.result.totalRecords, 2);
    assert.match(x.captured.error.join('\n'), /ZEITBUDGET GERISSEN/i);
    assert.doesNotMatch(x.captured.warn.join('\n'), /HIT MAX_PAGES/i);
  });

  const legacyShapes = [
    ['top-level rows object with explicit null total', topLevelPayload([row('AAA')], null)],
    ['top-level row array', [row('AAA')]],
    ['stocks array', { stocks: [row('AAA')] }],
  ];

  for (const [label, response] of legacyShapes) {
    await t.test(`legacy OTC response shape remains compatible: ${label}`, async () => {
      const x = await exercise({ 1: response });

      assert.deepEqual(x.calls.map((call) => call.page), [1, 2]);
      assert.deepEqual(x.sleeps, [500]);
      assert.deepEqual([...x.result.keys()], ['AAA']);
      assertComplete(x.result);
      assert.deepEqual(x.captured.warn, []);
      assert.deepEqual(x.captured.error, []);
    });
  }

  await t.test('top-level rows shape normalizes numeric-string totalRecords', async () => {
    const x = await exercise({ 1: topLevelPayload([], '1') });

    assert.deepEqual(x.calls.map((call) => call.page), [1]);
    assert.equal(x.result.partial, true);
    assert.equal(x.result.totalRecords, 1);
    assert.equal(typeof x.result.totalRecords, 'number');
    assertPaginationWarning(x.captured, 1, 0, 1);
  });

  await t.test('top-level rows shape rejects malformed totalRecords before accepting rows', async () => {
    const x = await exercise({ 1: topLevelPayload([row('BAD')], {}) });

    assert.deepEqual(x.calls.map((call) => call.page), [1, 2]);
    assert.equal(x.result.has('BAD'), false);
    assert.equal(x.result.partial, true);
    assert.match(x.captured.error.join('\n'), /Page\s*1\s+failed.*totalRecords/i);
  });
});
