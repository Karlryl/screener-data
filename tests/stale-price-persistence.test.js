'use strict';
// Real pull/guard paths with virtual provider and filesystem. Break only copied production source in memory.
process.env.RUN_DATE_UTC = '2026-10-30';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const vm = require('node:vm');
const { fixture, snapshot } = require('./stale-quarter-reload.test.js');
const root = path.resolve(__dirname, '..');
const guardFile = path.join(root, 'lib/market-cap-guard.js');
const pullFile = path.join(root, 'pull-yahoo.js');
const guardSource = fs.readFileSync(guardFile, 'utf8');
const pullSource = fs.readFileSync(pullFile, 'utf8');
const guard = require(guardFile);
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const hashes = [guardFile, pullFile, __filename].map(p => [p, sha(p)]);
const NOW = Date.parse('2026-10-30T10:00:00Z');
const OLD = '2026-10-02T15:35:06.000Z';
const FRESH = '2026-10-30T08:00:00.000Z';
const env = { RUN_DATE_UTC: '2026-10-30', STALE_QUARTER_RELOAD: '' };
function seed(stamp = OLD) {
  const s = snapshot('OLD', '2026-09-30');
  s.meta.asOf = s.meta.fetchedAt = s.meta.fundamentalsAsOf = FRESH;
  if (stamp) s.marketCap.regularMarketTime = stamp;
  return s;
}
function withheld(s, g = guard) {
  const bytes = JSON.stringify(s), out = g.prepareMarketCap(s);
  assert.equal(out.marketCap.value, null, 'known stale value readmitted');
  assert.equal(out.marketCap.missing, true);
  assert.equal(out.marketCap.source, g.STALE_PRICE_SOURCE);
  assert.match(out.meta.marketCapReason, /Yahoo/);
  assert.equal(JSON.stringify(s), bytes, 'reader mutated its input');
  return out;
}
function breakLine(source, anchor, replacement) {
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'exact whole-line anchor');
  return lines.map(l => l === anchor ? replacement : l).join('\n');
}
function compileGuard(source) {
  const m = new Module(guardFile, module); m.filename = guardFile;
  m.paths = Module._nodeModulePaths(path.dirname(guardFile)); m._compile(source, guardFile);
  return m.exports;
}
async function pull(s, {full = false, stamp, missing = false, corrupt = false, stored, source = pullSource} = {}) {
  const summaryResponse = { price: {currency:'USD', regularMarketPrice:100, marketCap:1e12, ...(stamp ? {regularMarketTime:stamp}: {})},
    summaryDetail:{marketCap:1e12}, financialData:{financialCurrency:'USD'}, quoteType:{quoteType:'EQUITY'},
    summaryProfile:{sector:'Technology', industry:'Software'} };
  const f = fixture({snapshots:[s], now:NOW, env, pullSource:source, manual:full ? ['OLD']:[],
    summaryResponse, emptySummary:missing, quoteMarketCap:missing ? null : 1e12, quoteTime:stamp});
  if (corrupt) f.files.set(path.join(f.out,'OLD.json'),Buffer.from('{broken'));
  if (stored) f.files.set(path.join(f.out,'OLD.json'),Buffer.from(JSON.stringify(stored)));
  const result = await f.run();
  if (!missing) assert.equal(result.results[0]?.status, full ? 'ok' : 'price-only', JSON.stringify({result,logs:f.logs.slice(-5)}));
  return f.stored('OLD');
}
function merged(previous, incoming, source = pullSource) {
  const files = new Map([['virtual-in/OLD.json',JSON.stringify(incoming)],['virtual-out/OLD.json',previous === 'corrupt' ? '{broken' : JSON.stringify(previous)]]);
  const key = p => String(p).replaceAll('\\','/');
  const io = new Proxy(fs,{get(target, prop) {
    if (prop === 'readdirSync') return p => key(p) === 'virtual-in' ? ['OLD.json'] : target[prop](p);
    if (prop === 'existsSync') return p => files.has(key(p)) || target[prop](p);
    if (prop === 'readFileSync') return (p,enc) => files.has(key(p)) ? (enc ? files.get(key(p)) : Buffer.from(files.get(key(p)))) : target[prop](p,enc);
    if (prop === 'mkdirSync') return () => {};
    return target[prop];
  }});
  const m = {exports:{}}, req = Module.createRequire(pullFile);
  const context = {module:m,exports:m.exports,__dirname:root,__filename:pullFile,process,console,Buffer,Date,setTimeout,clearTimeout,setImmediate,AbortController,
    require:id => id === 'fs' ? io : id === './lib/atomic-write.js' ? {writeFileAtomic:(p,s)=>files.set(key(p),s)} : req(id)};
  context.global=context; vm.runInNewContext(source, context, {filename:pullFile});
  m.exports.mergeSmallcapSnapshots('virtual-in','virtual-out');
  return JSON.parse(files.get('virtual-out/OLD.json'));
}
const DAMAGED_HOLDS = [{},{priceDay:'kein Datum'},{priceDay:'2026-02-45'},{priceDay:'2099-01-01'},{priceDay:7},true,[],'x',1];
const DAMAGED_METAS = [[],'kaputt',7,true];
const checks = {
  async repair(source = pullSource) {
    const fresh=await pull(seed(),{full:true,stamp:FRESH,corrupt:true,source});
    assert.equal(fresh.marketCap.regularMarketTime,FRESH);
    assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
  },
  async state(g = guard) {
    const prior = seed(), next = seed(null);
    const before = JSON.stringify(prior);
    g.retainStalePriceHold(next, prior, '2026-10-30');
    withheld(next,g); assert.equal(JSON.stringify(prior),before);
    assert.equal(next.marketCap.regularMarketTime,undefined,'old stamp attached to new value');
    assert.deepEqual(next.meta.stalePriceHold,{priceDay:'2026-10-02'});
    const again=structuredClone(next); g.retainStalePriceHold(again,next,'2026-10-30'); withheld(again,g);
    const fresh=seed(FRESH); g.retainStalePriceHold(fresh,again,'2026-10-30');
    assert.equal(fresh.meta.stalePriceHold,undefined); assert.equal(g.prepareMarketCap(fresh).marketCap.value,1e12);
    const unverified=seed(null); g.retainStalePriceHold(unverified,seed(null),'2026-10-30');
    assert.equal(g.prepareMarketCap(unverified),unverified);
    const missing={meta:{},marketCap:{value:null,regularMarketTime:FRESH}};
    g.retainStalePriceHold(missing,next,'2026-10-30'); assert.ok(missing.meta.stalePriceHold,'missing value erased hold');
  },
  async reason(g = guard) {
    assert.match(withheld(seed(),g).meta.marketCapReason,/Letzter von Yahoo gelieferter Kurs vom 02\.10\.2026/);
  },
  async price(source = pullSource) {
    const next=await pull(seed(),{source}); withheld(next); assert.equal(next.marketCap.regularMarketTime,undefined);
    const again=await pull(next,{source}); withheld(again);
    withheld(await pull(again,{stamp:0,source}));
    const fresh=await pull(again,{stamp:FRESH,source});
    assert.equal(fresh.meta.stalePriceHold,undefined);
    assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
    const virgin=await pull(seed(null),{source}); assert.equal(guard.prepareMarketCap(virgin).marketCap.value,1e12);
  },
  async full(source = pullSource) {
    const next=await pull(seed(),{full:true,source}); withheld(next); assert.equal(next.marketCap.regularMarketTime,undefined);
    const fresh=await pull(next,{full:true,stamp:FRESH,source});
    assert.equal(fresh.meta.stalePriceHold,undefined); assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
    const stale=await pull(seed(null),{full:true,stamp:OLD,source}); withheld(stale);
  },
  async missing(source = pullSource) {
    const next=await pull(seed(),{full:true,missing:true,source});
    assert.equal(next.marketCap.value,null); assert.ok(next.meta.stalePriceHold,'missing cap erased known staleness');
    withheld(await pull(next,{full:true,source}));
  },
  async merge(source = pullSource) {
    withheld(merged(seed(),seed(null),source));
    const fresh=merged(seed(),seed(FRESH),source); assert.equal(fresh.meta.stalePriceHold,undefined);
    assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
    const incoming=seed(null); guard.retainStalePriceHold(incoming,seed());
    withheld(merged(seed(null),incoming,source));
  },
  async carrier(source = pullSource) {
    const incoming=seed(null); guard.retainStalePriceHold(incoming,seed());
    incoming.marketCap={value:null,missing:true,asOf:FRESH,source:'yahoo_quoteSummary'};
    const stored=merged(seed(null),incoming,source);
    assert.ok(stored.meta.stalePriceHold,'missing carrier lost known staleness');
    withheld(await pull(stored,{full:true,source}));
  },
  async mergeRepair(source = pullSource) {
    const fresh=merged('corrupt',seed(FRESH),source);
    assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
  },
  // A damaged hold still withholds an unproven value, names no invented day, and never blocks a proven quote.
  async damagedHold(g = guard) {
    for (const hold of DAMAGED_HOLDS) {
      const s=seed(null); s.meta.stalePriceHold=structuredClone(hold);
      const reason=withheld(s,g).meta.marketCapReason;
      assert.match(reason,/nicht lesbar/,JSON.stringify(hold));
      assert.doesNotMatch(reason,/undefined|NaN|\d{2}\.\d{2}\.\d{4}/,JSON.stringify(hold));
      const again=seed(null); again.meta.stalePriceHold=structuredClone(hold);
      g.retainStalePriceHold(again,s,'2026-10-30');
      assert.deepEqual(JSON.parse(JSON.stringify(again.meta.stalePriceHold)),{priceDay:null},'hold not normalised: '+JSON.stringify(hold));
      withheld(again,g);
      const dated=seed(null); dated.meta.stalePriceHold=structuredClone(hold);
      g.retainStalePriceHold(dated,seed(),'2026-10-30');
      assert.deepEqual(dated.meta.stalePriceHold,{priceDay:'2026-10-02'},'readable evidence lost');
      const proven=seed(FRESH); proven.meta.stalePriceHold=structuredClone(hold);
      assert.equal(g.prepareMarketCap(proven).marketCap.value,1e12,'damaged hold blocked a current stamp');
      g.retainStalePriceHold(proven,s,'2026-10-30'); assert.equal(proven.meta.stalePriceHold,undefined);
    }
    const stamped=seed('2026-02-45T10:00:00.000Z');
    assert.equal(g.priceAge(stamped),null,'an impossible stamp counted as a date');
  },
  async damagedHoldPull(source = pullSource) {
    for (const hold of DAMAGED_HOLDS) for (const prior of [seed(),seed(null)]) {
      prior.meta.stalePriceHold=structuredClone(hold);
      const fresh=await pull(seed(),{full:true,stamp:FRESH,stored:prior,source});
      assert.equal(fresh.meta.stalePriceHold,undefined); assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
      withheld(await pull(seed(),{full:true,stored:prior,source}));
      withheld(await pull(seed(),{stored:prior,source}));
    }
  },
  // meta has to stay a plain object, otherwise the hold vanishes in JSON.stringify (array) or throws (string).
  async damagedMeta(g = guard) {
    for (const meta of DAMAGED_METAS) {
      const next=seed(null); next.meta=structuredClone(meta);
      assert.deepEqual(g.retainStalePriceHold(next,seed(),'2026-10-30'),{priceDay:'2026-10-02'});
      assert.deepEqual(JSON.parse(JSON.stringify(next)).meta.stalePriceHold,{priceDay:'2026-10-02'},'hold lost on save: '+JSON.stringify(meta));
      const old=seed(); old.meta=structuredClone(meta);
      const out=g.applyStalePriceGate(old,7,'2026-10-30'); assert.equal(out.status,'withheld');
      const saved=JSON.parse(JSON.stringify(old));
      assert.deepEqual(saved.meta.stalePriceHold,{priceDay:'2026-10-02'}); assert.match(saved.meta.marketCapReason,/Yahoo/);
      const untouched=seed(null); untouched.meta=structuredClone(meta);
      assert.equal(g.retainStalePriceHold(untouched,null,'2026-10-30'),null);
      assert.deepEqual(untouched.meta,meta,'meta without evidence must stay as found');
    }
  },
  async damagedMetaPull(source = pullSource) {
    for (const meta of DAMAGED_METAS) {
      const prior=seed(); prior.meta=structuredClone(meta);
      const missing=await pull(seed(),{full:true,missing:true,stored:prior,source});
      assert.deepEqual(missing.meta.stalePriceHold,{priceDay:'2026-10-02'},'hold lost on save: '+JSON.stringify(meta));
      withheld(await pull(seed(),{full:true,stored:{...missing,meta:{...missing.meta,ticker:'OLD'},annual:{},timeseries:{}},source}));
    }
  },
  // No expiry: only a current Yahoo stamp brings the value back, and every reason says so without claiming an end of trading.
  async noExpiry(g = guard) {
    const held=withheld(seed(),g);
    let s=held;
    for (const today of ['2026-11-30','2027-10-30','2030-01-02']) {
      const next=seed(null); g.retainStalePriceHold(next,s,today);
      assert.deepEqual(next.meta.stalePriceHold,{priceDay:'2026-10-02'});
      s=withheld(next,g);
    }
    const reasons=[held.meta.marketCapReason,s.meta.marketCapReason];
    const damaged=seed(null); damaged.meta.stalePriceHold={}; reasons.push(withheld(damaged,g).meta.marketCapReason);
    for (const reason of reasons) {
      assert.match(reason,/sobald Yahoo einen aktuellen Kurs liefert/,reason);
      assert.match(reason,/kein Handelsende/,reason);
    }
    const back=seed('2030-01-02T08:00:00.000Z'); g.retainStalePriceHold(back,s,'2030-01-02');
    assert.equal(back.meta.stalePriceHold,undefined);
    assert.equal(g.applyStalePriceGate(back,7,'2030-01-02').status,'fresh');
  },
};
const breaks = {
  state: () => compileGuard(breakLine(guardSource,'  if (hold) (snapshot.meta ??= {}).stalePriceHold = { ...hold };','  if (false) (snapshot.meta ??= {}).stalePriceHold = { ...hold };')),
  reason: () => compileGuard(breakLine(guardSource,'    `Letzter von Yahoo gelieferter Kurs vom ${germanDate(age.priceDay)}, älter als ${limit} Wochentage (Montag bis Freitag). ${STALE_PRICE_RETURN}`);','    `Letzter Kurs vom ${germanDate(age.priceDay)}; Börsenwert nicht gezeigt.`);')),
  damagedHold: () => compileGuard(breakLine(guardSource,'const heldDay = (hold, today) => { const d = realDay(hold?.priceDay); return d && d <= today ? d : null; };','const heldDay = hold => hold?.priceDay;')),
  damagedHoldPull: () => breakLine(pullSource,'      retainStalePriceHold(canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,','      void (canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,'),
  damagedMeta: () => compileGuard(breakLine(guardSource,"  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : (snapshot.meta = {});",'  return meta ?? (snapshot.meta = {});')),
  damagedMetaPull: () => breakLine(pullSource,'  retainStalePriceHold(snapshot, snapshot, observedAt.slice(0, 10));',''),
  noExpiry: () => compileGuard(breakLine(guardSource,"const STALE_PRICE_RETURN = 'Der Börsenwert wird nicht gezeigt und kommt von selbst zurück, sobald Yahoo einen aktuellen Kurs liefert. Ein veralteter Kurs allein belegt kein Handelsende.';","const STALE_PRICE_RETURN = 'Börsenwert nicht gezeigt.';")),
  price: () => breakLine(pullSource,'    retainStalePriceHold(existing, previousQuote, process.env.RUN_DATE_UTC || newAsOf.slice(0, 10));',''),
  full: () => breakLine(pullSource,'      retainStalePriceHold(canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,','      void (canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,'),
  missing: () => breakLine(pullSource,'  retainStalePriceHold(snapshot, snapshot, observedAt.slice(0, 10));',''),
  merge: () => breakLine(pullSource,'      retainStalePriceHold(incoming, previous);',''),
  carrier: () => breakLine(pullSource,'      retainStalePriceHold(written, incoming);',''),
  repair: () => breakLine(pullSource,'      retainStalePriceHold(canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,','      retainStalePriceHold(canonical, _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,'),
  mergeRepair: () => breakLine(pullSource,"        catch (error) { if (error.name !== 'SyntaxError') throw error; }",'        catch (error) { throw error; }'),
};
(async () => {
  const broken = process.argv.find(a => a.startsWith('--prove-red='))?.split('=')[1];
  const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
  try {
    if (broken) { assert.ok(checks[broken]); await checks[broken](breaks[broken]()); }
    else for (const [name, fn] of Object.entries(checks)) { if (!only || only === name) { await fn(); console.log('PASS '+name); } }
  } finally { for (const [p,h] of hashes) assert.equal(sha(p),h,'live source changed'); }
})().catch(e => { console.error(e); process.exitCode=1; });
