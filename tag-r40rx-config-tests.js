'use strict';
const assert = require('assert');

// Test 1: rule-of-40 uses threshold=40 by default
const R40 = require('./methods/rule-of-40.js');
const stock1 = {
  metrics: { revenueGrowthYoY: { value: 20 }, fcfMarginTTM: { value: 18 } },
  annual: {}
};
// 20 + 18 = 38 → below default threshold 40 → pass=false
const r1 = R40.evaluate(stock1);
assert.strictEqual(r1.computable, true, 'Test1: computable');
assert.strictEqual(r1.pass, false, 'Test1: R40=38 < 40 → pass=false');
assert.strictEqual(r1.value, 38, 'Test1: value=38');

const stock2 = {
  metrics: { revenueGrowthYoY: { value: 25 }, fcfMarginTTM: { value: 18 } },
  annual: {}
};
// 25 + 18 = 43 → above threshold 40 → pass=true
const r2 = R40.evaluate(stock2);
assert.strictEqual(r2.pass, true, 'Test2: R40=43 >= 40 → pass=true');

// Test 2: rule-of-x uses threshold=50 by default
const RX = require('./methods/rule-of-x.js');
const stock3 = {
  metrics: { revenueGrowthYoY: { value: 20 }, fcfMarginTTM: { value: 10 } }
};
// 1.5*20 + 10 = 40 → below threshold 50 → pass=false
const r3 = RX.evaluate(stock3);
assert.strictEqual(r3.computable, true, 'Test3: computable');
assert.strictEqual(r3.pass, false, 'Test3: RX=40 < 50 → pass=false');

const stock4 = {
  metrics: { revenueGrowthYoY: { value: 30 }, fcfMarginTTM: { value: 10 } }
};
// 1.5*30 + 10 = 55 → above threshold 50 → pass=true
const r4 = RX.evaluate(stock4);
assert.strictEqual(r4.pass, true, 'Test4: RX=55 >= 50 → pass=true');

console.log('tag-r40rx-config-tests: ALL PASS');
