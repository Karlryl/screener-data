#!/usr/bin/env node
'use strict';
// anchor-regression-nullmcap.js — Team-A infra anchor guard.
//
// PROVES the null-mcap-slot-protection change in refresh-universe.js is anchor-safe:
//   (A) The withMcap branch (marketCap!=null, sorted mcap DESC) is byte-identical
//       old-vs-new — every existing known-mcap row keeps its exact rank and payload.
//   (B) With NO foreign rows present (today's US-only universe), the ENTIRE capped
//       Map — keys, order, and JSON payload — is byte-identical old-vs-new.
//   (C) The Top-N-by-mcap set is byte-identical.
//   (D) NEW behavior only: when foreign (edinet/finmind/opendart/sse/szse/hkex)
//       null-mcap rows ARE present, they survive the cap instead of being crowded
//       out by the US-OTC null-mcap mass.
//
// It reproduces BOTH the OLD and the NEW cap algorithm verbatim on the same synthetic
// allTickers Map, so the diff isolates exactly the code under change. No network.
//
// ponytail: pure in-process algorithm mirror — the two functions below are copied
// from refresh-universe.js lines ~576-624 (old) and the patched version. If that
// block is edited again, re-sync NEW_cap here. Upgrade path: export the cap as a
// function from refresh-universe.js and import it, killing the copy.

// ---- OLD algorithm (pre-fix, F-DP-016) --------------------------------------
function OLD_cap(allTickers, MAX_UNIVERSE) {
  const withMcap    = [...allTickers.entries()].filter(([, v]) => v.marketCap != null && v.marketCap > 0);
  const withoutMcap = [...allTickers.entries()].filter(([, v]) => !v.marketCap);
  withMcap.sort((a, b) => b[1].marketCap - a[1].marketCap);
  const maxNullMcap  = Math.round(MAX_UNIVERSE * 0.20);
  const maxWithMcap  = MAX_UNIVERSE - Math.min(withoutMcap.length, maxNullMcap);
  const keptWithMcap = withMcap.slice(0, maxWithMcap);
  const keptNullMcap = withoutMcap.slice(0, MAX_UNIVERSE - keptWithMcap.length);
  return new Map([...keptWithMcap, ...keptNullMcap]);
}

// ---- NEW algorithm (post-fix, foreign-slot protection) ----------------------
function NEW_cap(allTickers, MAX_UNIVERSE, FOREIGN_SUBQUOTA) {
  const withMcap    = [...allTickers.entries()].filter(([, v]) => v.marketCap != null && v.marketCap > 0);
  const withoutMcap = [...allTickers.entries()].filter(([, v]) => !v.marketCap);
  withMcap.sort((a, b) => b[1].marketCap - a[1].marketCap);

  const FOREIGN_SOURCES = new Set(['edinet', 'finmind', 'opendart', 'sse', 'szse', 'hkex']);
  const isForeign = ([, v]) => {
    if (!v || !v.source) return false;
    return String(v.source).split(',').some(s => FOREIGN_SOURCES.has(s.trim()));
  };
  const decorated = withoutMcap.map((e, i) => ({ e, i, f: isForeign(e) ? 0 : 1 }));
  decorated.sort((a, b) => (a.f - b.f) || (a.i - b.i));
  for (let j = 0; j < decorated.length; j++) withoutMcap[j] = decorated[j].e;

  const maxNullMcap  = Math.round(MAX_UNIVERSE * 0.20);
  const maxWithMcap  = MAX_UNIVERSE - Math.min(withoutMcap.length, maxNullMcap);
  const keptWithMcap = withMcap.slice(0, maxWithMcap);
  const nullSlots    = MAX_UNIVERSE - keptWithMcap.length;
  const foreignCount = decorated.reduce((n, d) => n + (d.f === 0 ? 1 : 0), 0);
  const foreignReserve = Math.min(FOREIGN_SUBQUOTA, foreignCount, nullSlots);
  const keptForeign  = withoutMcap.slice(0, foreignReserve);
  const remainingSlots = nullSlots - keptForeign.length;
  const keptOther    = withoutMcap.slice(foreignReserve, foreignReserve + remainingSlots);
  const keptNullMcap = [...keptForeign, ...keptOther];
  return new Map([...keptWithMcap, ...keptNullMcap]);
}

// ---- byte-diff helpers ------------------------------------------------------
// A Map serialized as an ordered array of [key, JSON(value)] captures keys, ORDER,
// and payload — so "byte-identical" here means identical entries in identical order.
function serializeMap(m) {
  return JSON.stringify([...m.entries()].map(([k, v]) => [k, v]));
}
function withMcapProjection(m) {
  return JSON.stringify([...m.entries()].filter(([, v]) => v.marketCap != null && v.marketCap > 0));
}

// ---- synthetic universe mirroring the real allTickers shape -----------------
function makeUniverse({ nWithMcap, nOtcNull, foreign }) {
  const m = new Map();
  // Insertion order matters (Map preserves it) — mirror real discovery order:
  // mcap-bearing rows (NASDAQ API) first, then the US-OTC null-mcap mass, then
  // foreign adapters last (they run in the discoverySources array).
  for (let i = 0; i < nWithMcap; i++) {
    const t = 'MC' + i;
    m.set(t, { ticker: t, marketCap: 1e12 - i, name: t, sector: 'Tech', exchange: 'NASDAQ', source: 'nasdaq-api' });
  }
  for (let i = 0; i < nOtcNull; i++) {
    const t = 'OTC' + i;
    m.set(t, { ticker: t, marketCap: null, name: t, sector: '', exchange: 'OTC', source: 'otc-markets' });
  }
  for (const f of (foreign || [])) {
    m.set(f.ticker, { ticker: f.ticker, marketCap: null, name: f.ticker, sector: '', exchange: '', source: f.source });
  }
  return m;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { console.log('  FAIL  ' + name + (detail ? '  :: ' + detail : '')); failures++; }
}

const MAX = 25000;
const QUOTA = 2000;

console.log('anchor-regression-nullmcap — proving the null-mcap fix is anchor-safe\n');

// === Scenario 1: today's US-only universe (NO foreign rows). Must be identical. ===
// Sized like the live watchlist: >MAX total so the cap actually fires, mcap-heavy.
console.log('[1] US-only universe (23,748-row-like, no foreign) — full byte-identity:');
{
  const u = makeUniverse({ nWithMcap: 22000, nOtcNull: 8000, foreign: [] });
  const oldM = OLD_cap(new Map(u), MAX);
  const newM = NEW_cap(new Map(u), MAX, QUOTA);
  check('cap actually fired (input > MAX)', u.size > MAX, `size=${u.size}`);
  check('(B) full capped Map byte-identical (keys+order+payload)',
    serializeMap(oldM) === serializeMap(newM),
    `old=${oldM.size} new=${newM.size}`);
  check('(A) withMcap branch byte-identical',
    withMcapProjection(oldM) === withMcapProjection(newM));
  // (C) Top-N by mcap set identical — take top 500 keys in order.
  const topKeys = (m) => JSON.stringify([...m.keys()].filter(k => k.startsWith('MC')).slice(0, 500));
  check('(C) Top-500-by-mcap set byte-identical', topKeys(oldM) === topKeys(newM));
  check('output size unchanged', oldM.size === newM.size && newM.size === MAX);
}

// === Scenario 2: small US-only universe under the cap (cap does not fire path). ===
// Both algorithms are only reached when size>MAX in the real code; here we still
// assert the algorithms agree so the guard covers the boundary.
console.log('\n[2] US-only, mcap-light (many OTC nulls) — identity under 20% squeeze:');
{
  const u = makeUniverse({ nWithMcap: 3000, nOtcNull: 40000, foreign: [] });
  const oldM = OLD_cap(new Map(u), MAX);
  const newM = NEW_cap(new Map(u), MAX, QUOTA);
  check('full capped Map byte-identical', serializeMap(oldM) === serializeMap(newM),
    `old=${oldM.size} new=${newM.size}`);
  check('null-mcap kept count identical',
    [...oldM.values()].filter(v => !v.marketCap).length ===
    [...newM.values()].filter(v => !v.marketCap).length);
}

// === Scenario 3: foreign rows present but buried behind a huge OTC mass. ===
// OLD drops them all; NEW must keep them. This is the bug being fixed.
console.log('\n[3] Foreign adapters behind 30k US-OTC mass — survival test:');
{
  const foreign = [];
  for (let i = 0; i < 1500; i++) {
    const src = ['edinet', 'finmind', 'opendart', 'sse', 'szse', 'hkex'][i % 6];
    foreign.push({ ticker: 'FX' + src.toUpperCase() + i, source: src });
  }
  // mcap rows push maxWithMcap high, leaving only ~5000 (20% of 25k) null slots;
  // 30k OTC nulls come BEFORE the foreign rows in insertion order.
  const u = makeUniverse({ nWithMcap: 22000, nOtcNull: 30000, foreign });
  const oldM = OLD_cap(new Map(u), MAX);
  const newM = NEW_cap(new Map(u), MAX, QUOTA);

  const foreignSet = new Set(['edinet', 'finmind', 'opendart', 'sse', 'szse', 'hkex']);
  const isFrn = (v) => v && v.source && String(v.source).split(',').some(s => foreignSet.has(s.trim()));
  const oldForeignKept = [...oldM.values()].filter(isFrn).length;
  const newForeignKept = [...newM.values()].filter(isFrn).length;

  check('OLD algorithm starves foreign rows (bug reproduced)', oldForeignKept === 0,
    `old kept ${oldForeignKept} foreign`);
  check('(D) NEW keeps all 1500 foreign rows', newForeignKept === 1500,
    `new kept ${newForeignKept} foreign`);
  check('NEW still honors MAX_UNIVERSE cap', newM.size === MAX, `size=${newM.size}`);
  check('(A) withMcap branch STILL byte-identical with foreign present',
    withMcapProjection(oldM) === withMcapProjection(newM));
  // Foreign reserve never exceeds its quota:
  check('foreign kept <= subquota', newForeignKept <= QUOTA);
}

// === Scenario 4: subquota is a RESERVATION FLOOR, not a ceiling. ===
// With more foreign rows than the quota, the first 2000 are guaranteed by the
// reserve; the rest still compete for the remaining null slots (and, being sorted
// first, win them over OTC). The quota protects foreign rows; it never CAPS them
// below what free competition would give. Here nullSlots (~5000) > foreign (3000),
// so all 3000 survive — the reserve just guaranteed the first 2000 unconditionally.
console.log('\n[4] 3000 foreign vs 2000 subquota — quota is a floor, not a ceiling:');
{
  const foreign = [];
  for (let i = 0; i < 3000; i++) foreign.push({ ticker: 'FXE' + i, source: 'finmind' });
  const u = makeUniverse({ nWithMcap: 22000, nOtcNull: 30000, foreign });
  const newM = NEW_cap(new Map(u), MAX, QUOTA);
  const isFrn = (v) => v && v.source === 'finmind';
  const kept = [...newM.values()].filter(isFrn).length;
  check('reserve floor honored (>= min(quota, nullSlots))', kept >= QUOTA, `kept=${kept}`);
  check('all foreign survive when null slots exceed foreign count', kept === 3000, `kept=${kept}`);
  check('cap still exact', newM.size === MAX);

  // And a case where null slots are genuinely scarcer than the foreign count, so
  // foreign rows must displace OTC. With a small MAX=2000, the 20% null floor gives
  // only ~400 null slots for 3000 foreign: reserve=min(2000,3000,400)=400, keptOther
  // adds 0 → 400 foreign kept, and ZERO OTC survives (foreign displaces the US mass).
  const SMALL = 2000;
  const u2 = makeUniverse({ nWithMcap: 5000, nOtcNull: 30000, foreign });
  const newM2 = NEW_cap(new Map(u2), SMALL, QUOTA);
  const kept2 = [...newM2.values()].filter(isFrn).length;
  const nullSlots2 = [...newM2.values()].filter(v => !v.marketCap).length;
  check('under scarcity, foreign fill ALL null slots', kept2 === nullSlots2, `foreign=${kept2} nullSlots=${nullSlots2}`);
  check('no OTC survives when foreign exceed null slots',
    [...newM2.values()].filter(v => v.source === 'otc-markets').length === 0);
  check('small-cap MAX still exact', newM2.size === SMALL);
}

console.log('\n' + (failures === 0
  ? 'ANCHOR-REGRESSION PASSED — existing withMcap universe + Top-N are byte-identical; foreign rows now protected.'
  : `ANCHOR-REGRESSION FAILED — ${failures} check(s) failed.`));
process.exit(failures === 0 ? 0 : 1);
