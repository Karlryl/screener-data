'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(__dirname, 'fixtures/cn-printed');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const fixture = ticker => ({ ...manifest.find(r => r.ticker === ticker), text: fs.readFileSync(path.join(DIR, ticker + '.txt'), 'utf8') });
function sandbox() {
  const base = process.env.B11_TEST_DIR || path.join(ROOT, 'outputs/cn-printed-tests');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'case-'));
  if (path.resolve(dir) === path.join(ROOT, 'external-data/exchange-quarters') || !path.resolve(dir).startsWith(path.resolve(base) + path.sep)) throw Error('unsafe-test-path');
  return dir;
}
function liveHashes() {
  const d = path.join(ROOT, 'external-data/exchange-quarters');
  return Object.fromEntries(['cn.json', 'tw.json', 'br.json', 'cn-printed.json'].map(f => [f,
    fs.existsSync(path.join(d, f)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex') : null]));
}
function vendorStore(fixtures) {
  const companies = {};
  for (const f of fixtures) {
    const ytd = {};
    for (const [year, a] of [[2026, f.anchor], [2025, f.priorAnchor]]) {
      ytd[year + '-09-30'] = [{ table: 'GINCOME', reportType: '三季报', operate: a.ytd, total: a.ytd, confirmedBy: [] }];
      ytd[year + '-06-30'] = [{ table: 'GINCOME', reportType: '中报', operate: a.ytd - a.current, total: a.ytd - a.current, confirmedBy: [] }];
    }
    companies[f.ticker] = { ytd };
  }
  return { market: 'CN', currency: 'CNY', unit: 1, companies };
}
module.exports = { ROOT, DIR, manifest, fixture, sandbox, liveHashes, vendorStore };
