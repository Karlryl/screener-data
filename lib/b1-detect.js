'use strict';
/**
 * lib/b1-detect.js — B1-Event-Erkennung (Protokoll Tag 389 §1, SHA-256 7b20e750…cf0f79).
 * EINE Implementierung für Instrumentierung (Discovery) UND konfirmatorischen Lauf
 * (Validation) — byte-gleiche Erkennungslogik, nur die Ära ist Parameter.
 *
 * collectRecords(store, {eraStart, eraEnd, cikFilter}) → { records, counters }
 *   je Firmen-Quartal (PIT-Snapshot asOf filed(t)): dYoY, dYoYprev, dOpMargin,
 *   derivedInvolved. YoY-Paarung via yoyPartner (~365d ±35d, Protokoll-Realisierung).
 * flagEvents(records, {minCohortN, pctl, winsorLo, winsorHi}) → annotiert je Record
 *   isEvent nach §1 (winsorisierte P90-Schwelle je Kalenderquartals-Kohorte,
 *   Mindest-N-Gate) und liefert Kohorten-Statistik.
 */
const secPit = require('./sec-pit.js');

const DEFAULTS = { minCohortN: 200, pctl: 0.90, winsorLo: 0.01, winsorHi: 0.99 };

function calQuarter(endIso) { return endIso.slice(0, 4) + 'Q' + (Math.floor((+endIso.slice(5, 7) - 1) / 3) + 1); }
function quantileSorted(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

// Ein CIK, eine Ära: Records je auswertbarem Firmen-Quartal.
function evaluateCik(store, cik, eraStart, eraEnd, counters) {
  let facts;
  try { facts = store.factsForCik(cik); } catch (_) { return []; }
  if (!facts) return [];
  counters.ciksParsed++;
  const fullRev = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.REV_CONCEPTS, { filedMode: 'earliest' });
  if (!fullRev.series.length) { counters.ciksNoRevenue++; return []; }
  const eraQs = fullRev.series.filter((p) => p.end >= eraStart && p.end <= eraEnd && p.filed);
  if (!eraQs.length) return [];
  const out = [];
  for (const t of eraQs) {
    counters.firmQuartersEvaluated++;
    const rev = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.REV_CONCEPTS, { asOf: t.filed });
    const S = rev.series;
    const tt = S.find((p) => p.end === t.end);
    if (!tt) continue;
    const idx = S.indexOf(tt);
    const tPrev = S[idx + 1], tPrev2 = S[idx + 2];
    const gapDays = (newer, older) => (Date.parse(newer.end) - Date.parse(older.end)) / 86400000;
    const consecutive = (newer, older) => {
      if (!newer || !older) return false;
      const gap = gapDays(newer, older);
      return gap >= 60 && gap <= 125;
    };
    if (!consecutive(tt, tPrev) || !consecutive(tPrev, tPrev2)) {
      counters.nonConsecutive++;
      continue;
    }
    const p4 = secPit.yoyPartner(S, tt);
    const p4Prev = tPrev ? secPit.yoyPartner(S, tPrev) : null;
    const p4Prev2 = tPrev2 ? secPit.yoyPartner(S, tPrev2) : null;
    if (!p4 || !tPrev || !p4Prev || p4.val <= 0 || p4Prev.val <= 0) { counters.yoyUndefined++; continue; }
    const yoyT = tt.val / p4.val - 1;
    const yoyT1 = tPrev.val / p4Prev.val - 1;
    let dYoYprev = null;
    if (tPrev2 && p4Prev2 && p4Prev2.val > 0) dYoYprev = yoyT1 - (tPrev2.val / p4Prev2.val - 1);
    if (dYoYprev === null) { counters.dyoyUndefined++; continue; }
    const op = secPit.pitQuarterlyWithDerivedQ4(facts, secPit.OP_INCOME_CONCEPTS, { asOf: t.filed });
    const opT = op.series.find((p) => p.end === tt.end);
    const opP4 = op.series.find((p) => p.end === p4.end);
    let dOpMargin = null;
    if (opT && opP4 && tt.val > 0 && p4.val > 0) dOpMargin = opT.val / tt.val - opP4.val / p4.val;
    if (dOpMargin === null) counters.opMarginUndefined++;
    const derivedInvolved = !!(tt.derived || (tPrev && tPrev.derived) || p4.derived || (p4Prev && p4Prev.derived));
    if (derivedInvolved) counters.derivedQ4Used++;
    counters.evaluable++;
    out.push({
      cik, end: tt.end, calQ: calQuarter(tt.end), filed: t.filed,
      dYoY: yoyT - yoyT1, dYoYprev, dOpMargin, derivedInvolved,
      revLtm: null, // optional, Aufrufer kann anreichern
    });
  }
  return out;
}

function collectRecords(store, { eraStart, eraEnd, ciks }) {
  const counters = {
    ciksTotal: ciks.length, ciksParsed: 0, ciksNoRevenue: 0,
    firmQuartersEvaluated: 0, yoyUndefined: 0, dyoyUndefined: 0,
    opMarginUndefined: 0, derivedQ4Used: 0, nonConsecutive: 0, evaluable: 0,
  };
  const records = [];
  for (const cik of ciks) records.push(...evaluateCik(store, cik, eraStart, eraEnd, counters));
  return { records, counters };
}

// §1-Event-Flagging über Kalenderquartals-Kohorten (mutiert records: isEvent, dYoYWins).
function flagEvents(records, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const byQ = new Map();
  for (const r of records) { let a = byQ.get(r.calQ); if (!a) byQ.set(r.calQ, a = []); a.push(r); }
  const cohorts = {};
  for (const [q, arr] of Array.from(byQ.entries()).sort()) {
    const vals = arr.map((r) => r.dYoY).sort((a, b) => a - b);
    const lo = quantileSorted(vals, o.winsorLo), hi = quantileSorted(vals, o.winsorHi);
    const wins = vals.map((v) => Math.min(hi, Math.max(lo, v))).sort((a, b) => a - b);
    const p90 = quantileSorted(wins, o.pctl);
    const n = arr.length;
    let ev = 0;
    for (const r of arr) {
      r.dYoYWins = Math.min(hi, Math.max(lo, r.dYoY));
      // Basis-Kriterium ohne Margen-Bedingung (View 4 des Protokolls §7) und
      // volles §1-Kriterium — beide hier geflaggt, damit jede View dieselbe
      // Erkennung konsumiert statt sie nachzubauen.
      const base = n >= o.minCohortN && r.dYoYWins >= p90 && r.dYoY > 0 && r.dYoYprev > 0;
      r.isEventNoMargin = base;
      r.isEvent = base && r.dOpMargin != null && r.dOpMargin > 0;
      if (r.isEvent) ev++;
    }
    cohorts[q] = { n, p90: p90 != null ? +p90.toFixed(4) : null, belowMinN: n < o.minCohortN, events: ev };
  }
  return cohorts;
}

// Alle CIK-Nummern aus dem Zip-Central-Directory (inkl. tote CIKs).
function listAllCiks(zipPath) {
  const fs = require('fs');
  const zp = zipPath || secPit.ZIP_PATH;
  const fd = fs.openSync(zp, 'r');
  const sz = fs.fstatSync(fd).size;
  const scan = Math.min(65557, sz);
  const tail = Buffer.alloc(scan);
  fs.readSync(fd, tail, 0, scan, sz - scan);
  let cdOffset = null, cdSize = null;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      cdOffset = tail.readUInt32LE(i + 16); cdSize = tail.readUInt32LE(i + 12);
      if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
        const locBuf = Buffer.alloc(20);
        fs.readSync(fd, locBuf, 0, 20, (sz - scan) + i - 20);
        const eocd64Offset = Number(locBuf.readBigUInt64LE(8));
        const e64 = Buffer.alloc(56);
        fs.readSync(fd, e64, 0, 56, eocd64Offset);
        cdSize = Number(e64.readBigUInt64LE(40)); cdOffset = Number(e64.readBigUInt64LE(48));
      }
      break;
    }
  }
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOffset);
  fs.closeSync(fd);
  const out = [];
  let pos = 0;
  while (pos < cd.length - 4) {
    if (cd.readUInt32LE(pos) !== 0x02014b50) break;
    const fnLen = cd.readUInt16LE(pos + 28), extraLen = cd.readUInt16LE(pos + 30), commentLen = cd.readUInt16LE(pos + 32);
    const name = cd.subarray(pos + 46, pos + 46 + fnLen).toString('utf8');
    if (/^CIK\d{10}\.json$/.test(name)) out.push(parseInt(name.slice(3, 13), 10));
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return out;
}

module.exports = { collectRecords, flagEvents, evaluateCik, listAllCiks, calQuarter, quantileSorted, DEFAULTS };
