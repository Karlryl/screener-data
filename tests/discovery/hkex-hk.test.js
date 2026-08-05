'use strict';
/**
 * HKEX-HK discovery adapter — live smoke test.
 * Fetches the real HKEX List of Securities .xlsx (keyless) and asserts the
 * contract: non-empty Map, every key is a "NNNN.HK" Yahoo ticker, entries carry
 * exchange/country/source, and a couple of blue chips resolve to their known code.
 *
 * Network-dependent by design (the whole point is proving the keyless endpoint
 * + dependency-free xlsx parse still work). On a network failure the adapter
 * fail-silently returns an empty Map; we treat that as a skip, not a hard fail,
 * so offline CI does not go red on an external outage.
 *
 * Usage:  node tests/discovery/hkex-hk.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { fetchHkexUniverse, parseSheet } = require('../../discovery/hkex-hk.js');

(async () => {
  const fixture = '<x:row r="2">' +
    '<x:c r="A2" t="str"><x:v>700</x:v></x:c>' +
    '<x:c r="B2" t="str"><x:v>TENCENT HOLDINGS</x:v></x:c>' +
    '<x:c r="C2" t="str"><x:v>Equity</x:v></x:c>' +
    '<x:c r="F2" t="str"><x:v>KYG875721634</x:v></x:c></x:row>';
  const parsed = parseSheet(fixture);
  assert.equal(parsed.size, 1, 'hermetische Equity-Zeile muss genau einen Treffer liefern');
  assert.equal(parsed.get('0700.HK').name, 'TENCENT HOLDINGS');
  assert.equal(parsed.get('0700.HK').isin, 'KYG875721634');

  const map = await fetchHkexUniverse();
  assert.ok(map instanceof Map, 'returns a Map');

  if (map.size === 0) {
    console.log('SKIP hkex-hk: empty Map (network/endpoint unavailable) — fail-silent contract held');
    process.exit(0);
  }

  // Real HK equity universe is ~2,700-2,900; guard against a partial/garbage parse.
  assert.ok(map.size > 1000, `rowCount>1000 (got ${map.size})`);

  const TICK_RE = /^\d{4}\.HK$/;
  for (const [key, info] of map) {
    assert.match(key, TICK_RE, `key ${key} is NNNN.HK`);
    assert.equal(info.ticker, key, `${key}: ticker matches map key`);
    assert.equal(info.exchange, 'HKEX', `${key}: exchange=HKEX`);
    assert.equal(info.country, 'Hong Kong', `${key}: country=Hong Kong`);
    assert.equal(info.source, 'hkex', `${key}: source=hkex`);
    assert.ok(typeof info.name === 'string' && info.name.length > 0, `${key}: has name`);
    if (info.isin !== undefined) {
      assert.match(info.isin, /^[A-Z0-9]{12}$/, `${key}: isin looks well-formed (${info.isin})`);
    }
  }

  // No 8xxxx RMB dual-counters should have leaked through (they'd be 5-digit base codes).
  assert.ok(!map.has('89988.HK'), 'RMB counter 89988.HK dropped');

  // Known blue chips resolve to their canonical padded codes.
  assert.ok(map.has('0700.HK'), 'Tencent 0700.HK present');
  assert.ok(map.has('9988.HK'), 'Alibaba 9988.HK present');
  assert.match(map.get('0700.HK').name, /TENCENT/i, '0700.HK is Tencent');

  console.log(`ok  hkex-hk: ${map.size} HK equities, all NNNN.HK, blue chips + ISINs verified`);
})().catch(e => { console.error('FAIL hkex-hk:', e.message); process.exit(1); });
