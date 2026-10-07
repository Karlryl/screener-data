'use strict';

// Run standalone: node lib/region-mapping.test.js
const assert = require('node:assert/strict');
const { getRegion, EXCHANGE_TO_REGION, CURRENCY_TO_REGION_FALLBACK } = require('./region-mapping.js');
let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
function tableFromGroups(groups) {
  return Object.fromEntries(Object.entries(groups).flatMap(([region, codes]) =>
    codes.split(' ').map(code => [code, region])));
}

// These literal expectations pin all documented mappings independently of the exported tables.
const expectedExchanges = tableFromGroups({
  US: 'NMS NYQ PCX ASE NGM NCM NAS NYS AMX OTC PNK OBB OQB OQX TOR VAN CNQ NEO',
  EU: 'GER FRA MUN STU DUS HAM LSE IOB PAR BRU AMS EBS SWX MIL MCE LIS VIE STO HEL CPH OSL ICE WAR PRA BUD',
  APAC: 'TYO JPX HKG SHH SHZ KOE KSC KOSDAQ ASX NZE SGX TAI TWO',
  EM: 'BSE NSI IND SAO BVMF MEX MEXICO JNB JSE IST BIST MIC MCX SAU TADAWUL',
});
const expectedCurrencies = tableFromGroups({
  US: 'USD CAD',
  EU: 'EUR GBP CHF SEK NOK DKK PLN CZK HUF',
  APAC: 'JPY HKD CNY KRW AUD NZD SGD TWD',
  EM: 'INR BRL MXN ZAR TRY RUB SAR',
});
check(EXCHANGE_TO_REGION, expectedExchanges, 'complete documented exchange table');
check(CURRENCY_TO_REGION_FALLBACK, expectedCurrencies, 'complete documented currency fallback table');
check(EXCHANGE_TO_REGION.UNKNOWN, undefined, 'unknown exchange has no own mapping');
check(EXCHANGE_TO_REGION[''], undefined, 'empty exchange has no mapping');
check(CURRENCY_TO_REGION_FALLBACK.UNKNOWN, undefined, 'unknown currency has no own mapping');
check(CURRENCY_TO_REGION_FALLBACK[''], undefined, 'empty currency has no mapping');
for (const [exchange, region] of Object.entries(expectedExchanges)) {
  check(getRegion({ meta: { exchange } }), region, `exchange ${exchange}`);
}
for (const [currency, region] of Object.entries(expectedCurrencies)) {
  check(getRegion({ price: { currency } }), region, `price currency ${currency}`);
  check(getRegion({ meta: { currency } }), region, `meta currency ${currency}`);
}
for (const region of ['US', 'EU', 'APAC', 'EM', 'OTHER']) {
  check(getRegion({ meta: { region, exchange: 'NYQ' }, price: { currency: 'JPY' } }),
    region, `explicit ${region} overrides exchange and currency`);
}
const displayNames = tableFromGroups({
  US: 'Nasdaq NasdaqCM NasdaqGM NasdaqGS NYSE NYSEArca NASDAQ AMEX Toronto',
  EU: 'XETRA Frankfurt LSE',
  APAC: 'HKSE ASX Tokyo Shanghai Shenzhen KSE KOSDAQ',
});
Object.assign(displayNames, {
  'NYSE American': 'US', 'NYSE MKT': 'US', 'Cboe US': 'US',
  'OTC Markets OTCPK': 'US', 'OTC Markets OTCQX': 'US',
});
for (const [regionName, region] of Object.entries(displayNames)) {
  check(getRegion({ meta: { region: regionName, exchange: 'SAO' }, price: { currency: 'JPY' } }),
    region, `display name ${regionName} precedes exchange`);
}
check(getRegion({ meta: { region: 'unknown', exchange: 'GER' }, price: { currency: 'USD' } }),
  'EU', 'unknown explicit region falls through to exchange');
check(getRegion({ meta: { exchange: 'TYO', currency: 'EUR' }, price: { currency: 'USD' } }),
  'APAC', 'exchange takes priority over both currency sources');
check(getRegion({ meta: { exchange: 'unknown', currency: 'EUR' }, price: { currency: 'CAD' } }),
  'US', 'price currency takes priority over meta currency');
check(getRegion({ meta: { currency: 'EUR' }, price: { currency: '' } }),
  'EU', 'empty price currency falls back to meta currency');
check(getRegion({ meta: { currency: 'JPY' }, price: { currency: null } }),
  'APAC', 'null price currency falls back to meta currency');
// Current behavior: a nonempty unknown price currency prevents the valid meta fallback.
check(getRegion({ meta: { currency: 'EUR' }, price: { currency: 'unknown' } }),
  'OTHER', 'current unknown price currency precedence');
check(getRegion({ meta: { region: '', exchange: '' }, price: { currency: '' } }),
  'OTHER', 'empty identifiers');
check(getRegion({ meta: { region: 'us', exchange: 'nyq', currency: 'usd' } }),
  'OTHER', 'matching is case-sensitive');
check(getRegion({ meta: { exchange: ' NYQ ' } }), 'OTHER', 'no implicit whitespace normalization');
for (const stock of [undefined, null, NaN, -1, 0, '', {}, { meta: null }, { price: null }]) {
  check(getRegion(stock), 'OTHER', 'empty or malformed stock uses sentinel');
}
check(getRegion({ meta: { region: NaN, exchange: -1 }, price: { currency: NaN } }),
  'OTHER', 'invalid numeric identifiers fall through');
const stock = Object.freeze({
  meta: Object.freeze({ region: 'unknown', exchange: 'SAU', currency: 'USD' }),
  price: Object.freeze({ currency: 'EUR' }),
});
check(getRegion(stock), 'EM', 'frozen stock supports mapping');
check(stock, { meta: { region: 'unknown', exchange: 'SAU', currency: 'USD' }, price: { currency: 'EUR' } },
  'mapping leaves stock unchanged');

// Existing bug, deliberately documented rather than fixed by this test-only task:
// inherited object keys pass the truthiness lookup and violate the region-string contract.
check(getRegion({ meta: { region: 'constructor' } }), Object, 'current inherited display-name lookup');
check(getRegion({ meta: { exchange: 'constructor' } }), Object, 'current inherited exchange lookup');
check(getRegion({ price: { currency: 'constructor' } }), Object, 'current inherited currency lookup');

console.log(`region-mapping: ${assertions} assertions passed`);
