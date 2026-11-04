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
async function pull(s, {full = false, stamp, missing = false, corrupt = false, stored, source = pullSource, quarterlyRows = null, runDate = env.RUN_DATE_UTC} = {}) {
  const summaryResponse = { price: {currency:'USD', regularMarketPrice:100, marketCap:1e12, ...(stamp ? {regularMarketTime:stamp}: {})},
    summaryDetail:{marketCap:1e12}, financialData:{financialCurrency:'USD'}, quoteType:{quoteType:'EQUITY'},
    summaryProfile:{sector:'Technology', industry:'Software'} };
  const f = fixture({snapshots:[s], now:NOW, env:{...env, RUN_DATE_UTC:runDate}, pullSource:source, manual:full ? ['OLD']:[], quarterlyRows,
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
const LATER = '2026-11-20T08:00:00.000Z', AT_LIMIT = '2026-10-21T20:00:00.000Z', PAST_LIMIT = '2026-10-20T20:00:00.000Z';
const BAD_RUN_DAYS = ['31.10.2026','2026-13-45','gestern'];
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
    assert.match(withheld(seed(),g).meta.marketCapReason,/^Letzte Kursmeldung von Yahoo vom 02\.10\.2026, /);
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
    assert.match(reasons[1],/^Zuletzt als veraltet belegte Kursmeldung von Yahoo vom 02\.10\.2026; eine aktuelle Kursmeldung von Yahoo fehlt\. /);
    assert.match(reasons[2],/^Ein früherer Vermerk über eine veraltete Kursmeldung von Yahoo ist nicht lesbar; eine aktuelle Kursmeldung von Yahoo fehlt\. /);
    for (const reason of reasons) {
      assert.match(reason,/sobald Yahoo eine aktuelle Kursmeldung liefert/,reason);
      assert.match(reason,/Tageskurse können neuer sein/,reason);
      assert.doesNotMatch(reason,/Letzter von Yahoo|Yahoo-Kurs|einen aktuellen Kurs/,'old wording: '+reason);
      assert.match(reason,/kein Handelsende/,reason);
    }
    const back=seed('2030-01-02T08:00:00.000Z'); g.retainStalePriceHold(back,s,'2030-01-02');
    assert.equal(back.meta.stalePriceHold,undefined);
    assert.equal(g.applyStalePriceGate(back,7,'2030-01-02').status,'fresh');
  },
  // The stamp also travels through the replacement path of a period regress (12 rows on 31.10.).
  async regress(source = pullSource) {
    const old = () => { const s=snapshot('OLD','2026-06-30','2026-10-29T10:00:00Z'); s.meta.asOf=FRESH; s.meta.fetchedAt=s.meta.fundamentalsAsOf='2026-08-01T10:00:00Z'; return s; };
    const quarterlyRows=[{date:'2025-12-31',totalRevenue:90,grossProfit:30,operatingIncome:15,netIncome:8},{date:'2026-03-31',totalRevenue:100,grossProfit:40,operatingIncome:20,netIncome:10}];
    const stale=await pull(old(),{stamp:OLD,quarterlyRows,source});
    assert.ok(stale.meta.fundamentalsRetainedReason,'fixture left the period-regress path');
    assert.equal(stale.marketCap.regularMarketTime,OLD,'stamp lost on the replacement path');
    assert.deepEqual(stale.meta.stalePriceHold,{priceDay:'2026-10-02'}); withheld(stale);
    const fresh=await pull(old(),{stamp:FRESH,quarterlyRows,source});
    assert.equal(fresh.marketCap.regularMarketTime,FRESH); assert.equal(guard.prepareMarketCap(fresh).marketCap.value,1e12);
  },
  // A stamp after the run day proves no current quote, in either function.
  async futureRetain(g = guard) {
    assert.deepEqual(g.retainStalePriceHold(seed(LATER),seed(),'2026-10-30'),{priceDay:'2026-10-02'},'future stamp released the hold');
  },
  async futureGate(g = guard) {
    const held=seed(LATER); held.meta.stalePriceHold={priceDay:'2026-10-02'};
    assert.equal(g.applyStalePriceGate(held,7,'2026-10-30').status,'withheld','future stamp released the hold');
    assert.match(held.meta.marketCapReason,/vom 02\.10\.2026/);
  },
  // 7 weekdays before Friday 30.10. is the limit: 21.10. is still current, 20.10. is not.
  async limitPrior(g = guard) {
    assert.equal(g.priceAge(seed(AT_LIMIT),100,'2026-10-30').age,7); assert.equal(g.priceAge(seed(PAST_LIMIT),100,'2026-10-30').age,8);
    assert.equal(g.retainStalePriceHold(seed(null),seed(AT_LIMIT),'2026-10-30'),null,'a prior quote at the limit is no staleness');
    assert.deepEqual(g.retainStalePriceHold(seed(null),seed(PAST_LIMIT),'2026-10-30'),{priceDay:'2026-10-20'});
  },
  async limitCurrent(g = guard) {
    const at=seed(AT_LIMIT); at.meta.stalePriceHold={priceDay:'2026-10-02'};
    assert.equal(g.retainStalePriceHold(at,null,'2026-10-30'),null,'a current quote at the limit releases the hold');
    const past=seed(PAST_LIMIT); past.meta.stalePriceHold={priceDay:'2026-10-02'};
    assert.deepEqual(g.retainStalePriceHold(past,null,'2026-10-30'),{priceDay:'2026-10-20'});
  },
  // A malformed RUN_DATE_UTC never releases a known stale hold; the clock day of the pull takes over.
  async runDayPrice(source = pullSource) {
    for (const runDate of BAD_RUN_DAYS) { const next=await pull(seed(),{runDate,source}); assert.deepEqual(next.meta.stalePriceHold,{priceDay:'2026-10-02'},'released by '+runDate); withheld(next); }
  },
  async runDayFull(source = pullSource) {
    for (const runDate of BAD_RUN_DAYS) { const next=await pull(seed(),{full:true,runDate,source}); assert.deepEqual(next.meta.stalePriceHold,{priceDay:'2026-10-02'},'released by '+runDate); withheld(next); }
  },
  // A valid RUN_DATE_UTC is the reference day in both directions, whatever the clock says (fixture clock: 30.10.).
  async runDayValid(source = pullSource) {
    for (const full of [false,true]) {
      const earlier=await pull(seed(),{full,stamp:OLD,runDate:'2026-10-05',source});
      assert.equal(earlier.meta.stalePriceHold,undefined,'valid earlier run day ignored: 02.10. is one weekday before it');
      const later=await pull(seed(FRESH),{full,stamp:FRESH,runDate:'2026-11-20',source});
      assert.deepEqual(later.meta.stalePriceHold,{priceDay:'2026-10-30'},'valid later run day ignored: 30.10. is 15 weekdays before it');
    }
  },
  // Codex R17, finding 1: a known hold stays named after an empty Yahoo answer; a row without a hold is no case.
  async emptyAfterHold(g = guard) {
    const s=seed(null); s.marketCap={value:null,missing:true,asOf:FRESH,source:'yahoo_quoteSummary'}; s.meta.stalePriceHold={priceDay:'2026-10-02'};
    const out=g.prepareMarketCap(s);
    assert.equal(out.marketCap.source,g.STALE_PRICE_SOURCE,'known hold not named after an empty answer');
    assert.match(out.meta.marketCapReason,/^Zuletzt als veraltet belegte Kursmeldung von Yahoo vom 02\.10\.2026; der letzte Abruf lieferte keinen Börsenwert\. /);
    const none=seed(null); none.marketCap={value:null,missing:true,asOf:FRESH};
    assert.equal(g.prepareMarketCap(none).meta.marketCapReason,undefined,'a row without value and without a hold was named');
  },
  // A hand-table hold keeps its own reason after an empty answer too; the gate adds nothing to it.
  async emptyAfterHoldHand(g = guard) {
    const s=seed(null); s.meta.ticker='ARX.TO'; s.marketCap={value:null,missing:true,asOf:FRESH,source:'yahoo_quoteSummary'}; s.meta.stalePriceHold={priceDay:'2026-10-02'};
    const out=g.prepareMarketCap(s);
    assert.equal(out.marketCap.source,'hand-table:market-cap-hold','hand hold overwritten');
    assert.ok(out.meta.marketCapReason.startsWith('Börsenwert nicht verlässlich: '+guard.holds['ARX.TO'].reason),'hand reason replaced');
  },
  // Every break below has to apply: a stale anchor would prove a check red for the wrong reason.
  async anchors() {
    for (const name of Object.keys(breaks)) { assert.ok(checks[name],'break without a check: '+name); breaks[name](); }
  },
};
const breaks = {
  state: () => compileGuard(breakLine(guardSource,'  if (hold) metaOf(snapshot).stalePriceHold = { ...hold };','  if (false) metaOf(snapshot).stalePriceHold = { ...hold };')),
  reason: () => compileGuard(breakLine(guardSource,'    `Letzte Kursmeldung von Yahoo vom ${germanDate(age.priceDay)}, älter als ${limit} Wochentage (Montag bis Freitag). ${STALE_PRICE_RETURN}`);','    `Letzter von Yahoo gelieferter Kurs vom ${germanDate(age.priceDay)}, älter als ${limit} Wochentage (Montag bis Freitag). ${STALE_PRICE_RETURN}`);')),
  damagedHold: () => compileGuard(breakLine(guardSource,'const heldDay = (hold, today) => { const d = realDay(hold?.priceDay); return d && d <= today ? d : null; };','const heldDay = hold => hold?.priceDay;')),
  damagedHoldPull: () => breakLine(pullSource,'      retainStalePriceHold(canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,','      void (canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,'),
  damagedMeta: () => compileGuard(breakLine(guardSource,"  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : (snapshot.meta = {});",'  return meta ?? (snapshot.meta = {});')),
  damagedMetaPull: () => breakLine(pullSource,'  retainStalePriceHold(snapshot, snapshot, observedAt.slice(0, 10));',''),
  noExpiry: () => compileGuard(breakLine(guardSource,"const STALE_PRICE_RETURN = 'Der Börsenwert wird nicht gezeigt und kommt von selbst zurück, sobald Yahoo eine aktuelle Kursmeldung liefert. Tageskurse können neuer sein, und eine alte Kursmeldung allein belegt kein Handelsende.';","const STALE_PRICE_RETURN = 'Der Börsenwert wird nicht gezeigt und kommt von selbst zurück, sobald Yahoo einen aktuellen Kurs liefert. Ein veralteter Kurs allein belegt kein Handelsende.';")),
  price: () => breakLine(pullSource,'    retainStalePriceHold(existing, previousQuote, _holdRunDay(newAsOf));',''),
  full: () => breakLine(pullSource,'      retainStalePriceHold(canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,','      void (canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,'),
  missing: () => breakLine(pullSource,'  retainStalePriceHold(snapshot, snapshot, observedAt.slice(0, 10));',''),
  merge: () => breakLine(pullSource,'      retainStalePriceHold(incoming, previous);',''),
  carrier: () => breakLine(pullSource,'      retainStalePriceHold(written, incoming);',''),
  repair: () => breakLine(pullSource,'      retainStalePriceHold(canonical, _parsedSnapshot && _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,','      retainStalePriceHold(canonical, _priorSnapshotText ? JSON.parse(_priorSnapshotText) : null,'),
  mergeRepair: () => breakLine(pullSource,"        catch (error) { if (error.name !== 'SyntaxError') throw error; }",'        catch (error) { throw error; }'),
  regress: () => breakLine(pullSource,"              regularMarketTime: _y(yahoo.price, 'regularMarketTime'),",''),
  futureRetain: () => compileGuard(breakLine(guardSource,'  const provenCurrent = Number.isFinite(snapshot?.marketCap?.value) && current && current.priceDay <= today && current.age <= STALE_PRICE_WEEKDAYS;','  const provenCurrent = Number.isFinite(snapshot?.marketCap?.value) && current && current.age <= STALE_PRICE_WEEKDAYS;')),
  futureGate: () => compileGuard(breakLine(guardSource,'  if (known && (!age || age.priceDay > today)) {','  if (known && !age) {')),
  limitPrior: () => compileGuard(breakLine(guardSource,'  const knownDay = known.map(h => heldDay(h, today)).find(Boolean) ?? (prior?.age > STALE_PRICE_WEEKDAYS ? prior.priceDay : null);','  const knownDay = known.map(h => heldDay(h, today)).find(Boolean) ?? (prior?.age >= STALE_PRICE_WEEKDAYS ? prior.priceDay : null);')),
  limitCurrent: () => compileGuard(breakLine(guardSource,'  const provenCurrent = Number.isFinite(snapshot?.marketCap?.value) && current && current.priceDay <= today && current.age <= STALE_PRICE_WEEKDAYS;','  const provenCurrent = Number.isFinite(snapshot?.marketCap?.value) && current && current.priceDay <= today && current.age < STALE_PRICE_WEEKDAYS;')),
  runDayPrice: () => breakLine(pullSource,'    retainStalePriceHold(existing, previousQuote, _holdRunDay(newAsOf));','    retainStalePriceHold(existing, previousQuote, process.env.RUN_DATE_UTC || newAsOf.slice(0, 10));'),
  runDayFull: () => breakLine(pullSource,'        _holdRunDay(asOf));','        process.env.RUN_DATE_UTC || asOf.slice(0, 10));'),
  runDayValid: () => breakLine(pullSource,'const _holdRunDay = asOf => sizeExitRunDay(process.env, () => Date.parse(asOf));','const _holdRunDay = asOf => asOf.slice(0, 10);'),
  emptyAfterHold: () => compileGuard(breakLine(guardSource,"    if (!known || snapshot.meta.marketCapReason) return { status: 'no-value' };","    return { status: 'no-value' };")),
  emptyAfterHoldHand: () => compileGuard(breakLine(guardSource,"    if (!known || snapshot.meta.marketCapReason) return { status: 'no-value' };","    if (!known) return { status: 'no-value' };")),
};
(async () => {
  const broken = process.argv.find(a => a.startsWith('--prove-red='))?.split('=')[1];
  const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
  try {
    if (broken) {
      assert.ok(checks[broken]);
      // Exit 2, not 1: a break that does not apply is a broken harness, never a check proven red.
      let sabotaged;
      try { sabotaged = breaks[broken](); } catch (e) { console.error('HARNESS BROKEN, check not run: '+e.message); process.exitCode=2; return; }
      await checks[broken](sabotaged);
    }
    else for (const [name, fn] of Object.entries(checks)) { if (!only || only === name) { await fn(); console.log('PASS '+name); } }
  } finally { for (const [p,h] of hashes) assert.equal(sha(p),h,'live source changed'); }
})().catch(e => { console.error(e); process.exitCode=1; });
