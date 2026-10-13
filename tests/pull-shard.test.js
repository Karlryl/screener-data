'use strict';
/**
 * 0.2/0.9 Sharding (Tag 279) — deterministische Watchlist-Partition fuer parallele Pull-Matrix-Jobs.
 * Beweist: (1) N Shards partitionieren das Universum VOLLSTAENDIG + DISJUNKT; (2) STABIL (ein Ticker landet
 * unabhaengig von Reihenfolge/Groesse immer im selben Shard -> Cache-konsistent); (3) ~gleichverteilt;
 * (4) parseArgs --shard i/N robust (ungueltig -> kein Shard = volles Universum, nie ein stiller Teil-Pull).
 *
 * Usage:  node tests/pull-shard.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { shardHash, shardStocks, parseArgs } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// synthetisches Universum
const stocks = [];
for (let i = 0; i < 5000; i++) stocks.push({ ticker: 'T' + i + (i % 3 === 0 ? '.HK' : ''), isin: 'US' + i });

test('vollstaendige + disjunkte Partition ueber N Shards (Union == Universum, keine Doppel)', () => {
  for (const N of [1, 4, 17, 20]) {
    const seen = new Set();
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const shard = shardStocks(stocks, { index: i, count: N });
      sum += shard.length;
      for (const s of shard) {
        assert.ok(!seen.has(s.ticker), `${s.ticker} in mehr als einem Shard (N=${N})`);
        seen.add(s.ticker);
      }
    }
    assert.equal(sum, stocks.length, `Summe der Shard-Groessen != Universum (N=${N})`);
    assert.equal(seen.size, stocks.length, `nicht alle Ticker abgedeckt (N=${N})`);
  }
});

test('stabil: ein Ticker landet unabhaengig von Reihenfolge/Groesse im selben Shard', () => {
  const N = 12;
  const shardOf = (t) => shardHash(t) % N;
  // Reihenfolge egal (Hash haengt nur am Ticker)
  const s0 = shardOf('CRDO'), s1 = shardOf('CRDO');
  assert.equal(s0, s1, 'gleicher Ticker -> gleicher Shard');
  // in einer GEWACHSENEN Watchlist bleibt die Zuordnung gleich (Hash nicht index-basiert)
  const grown = stocks.concat([{ ticker: 'NEWLY_IPOd' }]);
  const before = shardStocks(stocks, { index: 3, count: N }).map((s) => s.ticker).sort();
  const after = shardStocks(grown, { index: 3, count: N }).filter((s) => s.ticker !== 'NEWLY_IPOd').map((s) => s.ticker).sort();
  assert.deepEqual(after, before, 'Universe-Wachstum verschiebt bestehende Ticker NICHT in andere Shards');
});

test('~gleichverteilt (jeder Shard 1/N +- 25%)', () => {
  const N = 17;
  const sizes = [];
  for (let i = 0; i < N; i++) sizes.push(shardStocks(stocks, { index: i, count: N }).length);
  const exp = stocks.length / N;
  for (const sz of sizes) assert.ok(Math.abs(sz - exp) < exp * 0.25, `Shard-Groesse ${sz} zu weit von ${exp.toFixed(0)} (Balance)`);
});

test('parseArgs --shard i/N robust; ungueltig -> kein Shard (voller Pull, nie stiller Teil-Pull)', () => {
  assert.deepEqual(parseArgs(['node', 'x', '--shard', '3/17']).shard, { index: 3, count: 17 });
  assert.equal(parseArgs(['node', 'x']).shard, null);
  for (const bad of ['17/17', '-1/4', 'x/4', '3/0', '3']) {
    assert.equal(parseArgs(['node', 'x', '--shard', bad]).shard, null, `ungueltig "${bad}" muss ignoriert werden`);
  }
});

console.log(`\npull-shard.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
