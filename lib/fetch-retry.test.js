'use strict';

// S02 tests the slot scheduler only. HTTPS and retry behavior belong to other guards.
const assert = require('node:assert/strict');
const { _internals: { warteAufSlot, letzterAbruf } } = require('./fetch-retry.js');
// A pending Promise does not keep Node alive. This real timer must stay outside
// the fake scheduler so a dropped resolver cannot turn an incomplete run green.
const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;

let pass = 0, fail = 0;
async function test(name, initial, fn) {
  const originalNow = Date.now, originalTimer = global.setTimeout;
  const originalSlots = [...letzterAbruf];
  let now = 10_000;
  let completionDeadline;
  const timers = [];
  try {
    letzterAbruf.clear();
    for (const [host, time] of initial) letzterAbruf.set(host, time);
    Date.now = () => now;
    global.setTimeout = (callback, ms) => { timers.push({ callback, ms }); return 0; };
    const deadline = new Promise((_, reject) => {
      completionDeadline = realSetTimeout(() => reject(new assert.AssertionError({
        message: 'asynchronous case did not complete within 1000 ms: ' + name,
      })), 1000);
    });
    await Promise.race([fn({ timers, advanceTo: value => { now = value; } }), deadline]);
    pass++;
    console.log('  ok   ' + name);
  } catch (error) {
    fail++;
    console.error('FAIL   ' + name + '\n' + error.stack);
  } finally {
    realClearTimeout(completionDeadline);
    Date.now = originalNow;
    global.setTimeout = originalTimer;
    letzterAbruf.clear();
    for (const [host, time] of originalSlots) letzterAbruf.set(host, time);
  }
  assert.equal(Date.now, originalNow);
  assert.equal(global.setTimeout, originalTimer);
  assert.deepEqual([...letzterAbruf], originalSlots, 'slot fixtures must be restored');
}

(async () => {
  await test('an unseen host receives its first timestamp without sleeping', [['other.invalid', 9_950]], async ({ timers }) => {
    assert.equal(await warteAufSlot('first.invalid', 100), undefined);
    assert.deepEqual(timers, []);
    assert.equal(letzterAbruf.get('first.invalid'), 10_000, 'first slot records the current clock');
    assert.equal(letzterAbruf.get('other.invalid'), 9_950);
    assert.equal(letzterAbruf.size, 2);
  });

  await test('an occupied slot waits only the remaining pause and stamps actual completion', [['same.invalid', 9_980]], async ({ timers, advanceTo }) => {
    let completed = false;
    const pending = warteAufSlot('same.invalid', 50).then(() => { completed = true; });
    assert.deepEqual(timers.map(timer => timer.ms), [30], '20 elapsed ms leave 30 ms to wait');
    await Promise.resolve();
    assert.equal(completed, false, 'the slot cannot complete before the timer fires');
    assert.equal(letzterAbruf.get('same.invalid'), 9_980, 'no timestamp is reserved prematurely');
    advanceTo(10_045); // A late timer must record wake-up time, not start or scheduled time.
    timers[0].callback();
    await pending;
    assert.equal(completed, true);
    assert.equal(letzterAbruf.get('same.invalid'), 10_045);
    assert.equal(timers.length, 1);
  });

  await test('an exact or expired pause boundary needs no timer', [['boundary.invalid', 9_900]], async ({ timers, advanceTo }) => {
    await warteAufSlot('boundary.invalid', 100);
    assert.deepEqual(timers, [], 'equality at the pause boundary is already eligible');
    assert.equal(letzterAbruf.get('boundary.invalid'), 10_000);
    advanceTo(10_101);
    await warteAufSlot('boundary.invalid', 100);
    assert.deepEqual(timers, [], 'an expired pause must not schedule a zero/negative timer');
    assert.equal(letzterAbruf.get('boundary.invalid'), 10_101);
  });

  await test('a different port has an independent slot and preserves other hosts', [['service.invalid:443', 10_000]], async ({ timers }) => {
    await warteAufSlot('service.invalid:8443', 100);
    assert.deepEqual(timers, []);
    assert.deepEqual([...letzterAbruf], [['service.invalid:443', 10_000], ['service.invalid:8443', 10_000]]);
    assert.equal(letzterAbruf.size, 2);
  });

  await test('zero pause still updates the host timestamp on every call', [], async ({ timers, advanceTo }) => {
    await warteAufSlot('zero.invalid', 0);
    assert.equal(letzterAbruf.get('zero.invalid'), 10_000);
    advanceTo(10_001);
    await warteAufSlot('zero.invalid', 0);
    assert.equal(letzterAbruf.get('zero.invalid'), 10_001);
    assert.deepEqual(timers, []);
  });
  console.log(`fetch-retry.test.js: ${pass} ok, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
