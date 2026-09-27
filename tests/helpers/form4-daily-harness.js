'use strict';

// Execute the real daily puller's main() with an in-memory cache and HTTP replies.
// No dependency may escape this allowlist into live filesystem/network operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/pull-insider-form4-daily.js');
const CALENDAR = path.join(ROOT, 'configs/edgar-holidays.json');

function loadDaily({ now = '2026-09-26T07:00:00Z', cursor = '20260904',
  env = {}, responses = {}, hits = {}, source = fs.readFileSync(SCRIPT, 'utf8') } = {}) {
  const requests = [], writes = [], logs = [];
  const initial = { lastIndexedDate: cursor, byTicker: {} };
  const epoch = Date.parse(now);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch])); }
    static now() { return epoch; }
  }
  const cachePath = path.join(ROOT, 'external-data/sec-form4-cache.json');
  const files = new Map([
    [path.join(ROOT, 'watchlist.json'), { stocks: [{ ticker: 'AAA' }] }],
    [path.join(ROOT, 'external-data/sec-ticker-cik-map.json'),
      { byTicker: { AAA: { cik: '0000000001', name: 'Fixture issuer' } } }],
  ]);
  const deps = {
    fs: {
      existsSync(file) {
        assert.equal(file, path.join(ROOT, 'external-data'));
        return true;
      },
      readFileSync(file) {
        assert.ok(files.has(file), 'Unexpected filesystem read: ' + file);
        return JSON.stringify(files.get(file));
      },
    },
    path,
    zlib: {},
    https: {
      get(url, options, callback) {
        requests.push(url);
        const match = /\/form\.(\d{8})\.idx$/.exec(url);
        assert.ok(match || /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1\//.test(url),
          'Unexpected HTTP request: ' + url);
        const date = match && match[1];
        const status = date ? (responses[date] ?? 200) : 200;
        const body = date
          ? Array.from({ length: hits[date] ?? 1 }, (_, i) =>
            `4 Fixture issuer 1 ${date} edgar/data/1/${date}-${i}.txt`).join('\n')
          : '<ownershipDocument/>';
        const request = new EventEmitter();
        request.setTimeout = () => request;
        request.destroy = () => {};
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = status;
          response.headers = {};
          response.resume = () => {};
          callback(response);
          response.emit('data', Buffer.from(body));
          response.emit('end');
        });
        return request;
      },
    },
    '../lib/atomic-write.js': {
      writeFileAtomic(file, body) {
        assert.equal(file, cachePath, 'Unexpected cache destination');
        writes.push(JSON.parse(body));
      },
    },
    './pull-insider-form4.js': {
      ladeForm4Cache: () => structuredClone(initial),
      parseForm4Xml: () => [],
    },
    '../lib/sec-user-agent': { secUserAgent: () => 'offline-test' },
    '../lib/sec-rate-limit.js': { RATE_DELAY_MS: 0, RATE_LIMIT_BACKOFF_MS: 0 },
    '../configs/edgar-holidays.json': JSON.parse(fs.readFileSync(CALENDAR, 'utf8')),
  };
  const mod = { exports: {} };
  vm.runInNewContext(source, {
    require(id) {
      assert.ok(Object.hasOwn(deps, id), 'Unexpected dependency: ' + id);
      return deps[id];
    },
    module: mod, __dirname: path.dirname(SCRIPT), Buffer, Date: Clock,
    process: { env: { DAYS: '5', ...env }, exit(code) { throw Object.assign(new Error('exit'), { exitCode: code }); } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(k => [k, (...args) => logs.push(args.join(' '))])),
    setTimeout: callback => queueMicrotask(callback),
  }, { filename: SCRIPT });
  return {
    api: mod.exports, requests, writes, logs,
    async run() {
      let exit = 0;
      try { await mod.exports.main(); }
      catch (error) {
        if (!Object.hasOwn(error, 'exitCode')) throw error;
        exit = error.exitCode;
      }
      return { exit, requests, writes, logs, cursor: writes.at(-1)?.lastIndexedDate,
        indexDates: requests.flatMap(url => /\/form\.(\d{8})\.idx$/.exec(url)?.slice(1) ?? []),
        filingFetches: requests.filter(url => url.endsWith('.txt')).length };
    },
  };
}

module.exports = { loadDaily, SCRIPT, CALENDAR };
