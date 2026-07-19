'use strict';
/**
 * lib/sec-pit.js — Point-in-Time-Reader über SEC companyfacts.zip (E-20260719-2).
 *
 * Kernidee (Bau-Entscheid 19.07.2026, Vergangenheits-Backtests B1–B6):
 * Das SEC-Bulk-Archiv companyfacts.zip IST bereits der PIT-Store — jeder Fakt
 * trägt nativ sein Einreichungsdatum (`filed`), jede Korrektur (10-K/A) liegt
 * als eigener Fakt daneben. Es braucht KEINEN abgeleiteten Zweit-Store (der
 * wäre nur eine zweite Wahrheit mit eigener Drift), sondern eine Lese-Semantik:
 *
 *   „Bekannt am Stichtag D" = alle Fakten mit filed <= D;
 *   „Korrektur gewinnt"     = je Periode gewinnt der Fakt mit dem JÜNGSTEN
 *                             filed unter diesen (spätere Einreichung ersetzt
 *                             frühere — 10-K/A schlägt 10-K, sobald bekannt).
 *
 * ZIP-Zugriff ist Random-Access über das Central Directory (eine CIK-Datei je
 * Firma, einzeln entpackbar in ms) — Parser verbatim aus enrich-q-revenue.js
 * (dort wiederum aus extract-ma-rpo.js; bewusst kopiert statt die Bestands-
 * Skripte umzubauen, die bleiben unangetastet).
 *
 * Ticker→CIK kommt aus company_tickers.json (SEC, gratis) — Download macht
 * scripts/sec-pit-check.js (braucht SEC_CONTACT als User-Agent, Repo-Regel);
 * diese Lib liest nur lokal, macht NIE Netz-Requests.
 *
 * Konsum: Backtests B1 ff. (_BACKTEST-KATALOG-frueher-finden-2026-07-16.md).
 * Bewusst NICHT Teil der Live-Pipeline (kein Import aus src/scoring) — die
 * Live-Boards bleiben auf ihrem eigenen Datenpfad.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Default-Pfade (Cache außerhalb des Checkouts, GG7c-Muster) ───────────────
const CACHE_DIR = process.env.SEC_XBRL_CACHE_DIR
  || path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'sec-xbrl-cache');
const ZIP_PATH = process.env.SEC_COMPANYFACTS_ZIP || path.join(CACHE_DIR, 'companyfacts.zip');
const TICKER_INDEX_PATH = path.join(CACHE_DIR, 'company_tickers.json');

// Diskretes Quartal = 80–110 Tage Periodendauer (BH-017-Regel aus
// enrich-q-revenue.js: fp=Q2/Q3 allein ist NICHT autoritativ, YTD-Fakten
// tragen dieselben fp-Labels). Jahresperiode analog 330–380 Tage.
const QUARTER_MIN_DAYS = 80, QUARTER_MAX_DAYS = 110;
const ANNUAL_MIN_DAYS = 330, ANNUAL_MAX_DAYS = 380;

// ── ZIP central-directory parser (verbatim from enrich-q-revenue.js) ─────────
function readUInt32LE(buf, o) { return buf.readUInt32LE(o); }
function readUInt16LE(buf, o) { return buf.readUInt16LE(o); }
function findEndOfCentralDir(fd, fileSize) {
  const scanSize = Math.min(65557, fileSize);
  const buf = Buffer.alloc(scanSize);
  fs.readSync(fd, buf, 0, scanSize, fileSize - scanSize);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const cdOffset = readUInt32LE(buf, i + 16), cdSize = readUInt32LE(buf, i + 12), cdCount = readUInt16LE(buf, i + 10);
      if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) return findEndOfCentralDir64(fd, fileSize, (fileSize - scanSize) + i);
      return { cdOffset, cdSize, cdCount };
    }
  }
  throw new Error('EOCD signature not found');
}
function findEndOfCentralDir64(fd, fileSize, eocdPos) {
  const locBuf = Buffer.alloc(20);
  fs.readSync(fd, locBuf, 0, 20, eocdPos - 20);
  if (locBuf.readUInt32LE(0) !== 0x07064b50) throw new Error('ZIP64 locator not found');
  const eocd64Offset = Number(locBuf.readBigUInt64LE(8));
  const eocd64Buf = Buffer.alloc(56);
  fs.readSync(fd, eocd64Buf, 0, 56, eocd64Offset);
  if (eocd64Buf.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 EOCD not found');
  return { cdSize: Number(eocd64Buf.readBigUInt64LE(40)), cdOffset: Number(eocd64Buf.readBigUInt64LE(48)), cdCount: Number(eocd64Buf.readBigUInt64LE(24)) };
}
function buildCentralDirectory(fd, cdOffset, cdSize) {
  const cdBuf = Buffer.alloc(cdSize);
  fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);
  const index = new Map();
  let pos = 0;
  while (pos < cdBuf.length - 4) {
    if (cdBuf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = readUInt16LE(cdBuf, pos + 10), compSize = readUInt32LE(cdBuf, pos + 20), uncompSize = readUInt32LE(cdBuf, pos + 24);
    const fnLen = readUInt16LE(cdBuf, pos + 28), extraLen = readUInt16LE(cdBuf, pos + 30), commentLen = readUInt16LE(cdBuf, pos + 32);
    let localOffset = readUInt32LE(cdBuf, pos + 42);
    const fileName = cdBuf.subarray(pos + 46, pos + 46 + fnLen).toString('utf8');
    if (localOffset === 0xFFFFFFFF) {
      const extraStart = pos + 46 + fnLen; let ep = extraStart;
      while (ep < extraStart + extraLen - 3) {
        const hid = cdBuf.readUInt16LE(ep), hlen = cdBuf.readUInt16LE(ep + 2);
        if (hid === 0x0001) {
          let z64pos = ep + 4, z64uncompSize = uncompSize, z64compSize = compSize, z64localOffset = localOffset;
          if (uncompSize === 0xFFFFFFFF) { z64uncompSize = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          if (compSize === 0xFFFFFFFF) { z64compSize = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          if (localOffset === 0xFFFFFFFF) { z64localOffset = Number(cdBuf.readBigUInt64LE(z64pos)); z64pos += 8; }
          index.set(fileName, { localHeaderOffset: z64localOffset, compSize: z64compSize, uncompSize: z64uncompSize, method });
          break;
        }
        ep += 4 + hlen;
      }
    } else {
      index.set(fileName, { localHeaderOffset: localOffset, compSize, uncompSize, method });
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return index;
}
function readEntry(fd, entry) {
  const lhBuf = Buffer.alloc(30);
  fs.readSync(fd, lhBuf, 0, 30, entry.localHeaderOffset);
  const dataOffset = entry.localHeaderOffset + 30 + readUInt16LE(lhBuf, 26) + readUInt16LE(lhBuf, 28);
  const compBuf = Buffer.alloc(entry.compSize);
  fs.readSync(fd, compBuf, 0, entry.compSize, dataOffset);
  if (entry.method === 0) return compBuf;
  if (entry.method === 8) return zlib.inflateRawSync(compBuf);
  throw new Error('Unsupported compression method: ' + entry.method);
}

// ── Store-Handle (öffnet Zip einmal, liest CIK-Einträge on demand) ───────────
function openStore(zipPath) {
  const zp = zipPath || ZIP_PATH;
  if (!fs.existsSync(zp)) {
    throw new Error('[sec-pit] companyfacts.zip fehlt: ' + zp
      + ' — Download via scripts/sec-pit-check.js (gratis, sec.gov; SEC_CONTACT nötig).');
  }
  const fd = fs.openSync(zp, 'r');
  const size = fs.fstatSync(fd).size;
  const { cdOffset, cdSize } = findEndOfCentralDir(fd, size);
  const dir = buildCentralDirectory(fd, cdOffset, cdSize);
  let tickerMap = null; // lazy: Ticker(UPPER) -> CIK (number)
  return {
    zipPath: zp,
    entryCount: dir.size,
    close() { fs.closeSync(fd); },
    hasCik(cik) { return dir.has(cikEntryName(cik)); },
    factsForCik(cik) {
      const e = dir.get(cikEntryName(cik));
      if (!e) return null;
      return JSON.parse(readEntry(fd, e).toString('utf8'));
    },
    cikForTicker(ticker) {
      if (!tickerMap) tickerMap = loadTickerMap();
      const cik = tickerMap.get(String(ticker).toUpperCase());
      return cik == null ? null : cik;
    },
    factsForTicker(ticker) {
      const cik = this.cikForTicker(ticker);
      return cik == null ? null : this.factsForCik(cik);
    },
  };
}
function cikEntryName(cik) { return 'CIK' + String(cik).padStart(10, '0') + '.json'; }
function loadTickerMap(indexPath) {
  const p = indexPath || TICKER_INDEX_PATH;
  if (!fs.existsSync(p)) {
    throw new Error('[sec-pit] company_tickers.json fehlt: ' + p
      + ' — scripts/sec-pit-check.js lädt sie (gratis, sec.gov; SEC_CONTACT nötig).');
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const map = new Map();
  for (const v of Object.values(raw)) {
    if (v && v.ticker && Number.isFinite(v.cik_str)) map.set(String(v.ticker).toUpperCase(), v.cik_str);
  }
  if (map.size === 0) throw new Error('[sec-pit] company_tickers.json leer/unerwartetes Format: ' + p);
  return map;
}

// ── PIT-Kern: „bekannt am Stichtag, Korrektur gewinnt" ───────────────────────
function periodDays(u) {
  if (!u || !u.start || !u.end) return null;
  const d = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
  return Number.isFinite(d) ? d : null;
}
function isQuarterlyPoint(u) {
  const d = periodDays(u);
  return d != null && d >= QUARTER_MIN_DAYS && d <= QUARTER_MAX_DAYS;
}
function isAnnualPoint(u) {
  const d = periodDays(u);
  return d != null && d >= ANNUAL_MIN_DAYS && d <= ANNUAL_MAX_DAYS;
}

// Aus einer rohen Fakten-Liste (units-Array eines Konzepts) die PIT-Serie zum
// Stichtag bauen: nur filed <= asOf; je Perioden-Ende gewinnt das jüngste filed
// (Tie: jüngere Form-Reihenfolge egal — bei identischem filed nehmen wir den
// später gelisteten Fakt, SEC listet chronologisch). Rückgabe end-absteigend.
function pitSeriesFromFacts(unitFacts, { asOf, period = 'quarterly' } = {}) {
  if (!Array.isArray(unitFacts)) return [];
  const accept = period === 'annual' ? isAnnualPoint
    : period === 'quarterly' ? isQuarterlyPoint
    : period === 'instant' ? ((u) => !!u.end && !u.start)
    : null;
  if (!accept) throw new Error('[sec-pit] unbekannte period: ' + period);
  const asOfMs = asOf ? Date.parse(asOf) : Infinity;
  if (asOf && !Number.isFinite(asOfMs)) throw new Error('[sec-pit] asOf unlesbar: ' + asOf);
  const byEnd = new Map(); // end -> gewinnender Fakt
  for (const u of unitFacts) {
    if (!u || !Number.isFinite(u.val) || !u.end || !u.filed) continue;
    if (!accept(u)) continue;
    const filedMs = Date.parse(u.filed);
    if (!Number.isFinite(filedMs) || filedMs > asOfMs) continue; // noch nicht bekannt
    const prev = byEnd.get(u.end);
    if (!prev || Date.parse(u.filed) >= Date.parse(prev.filed)) {
      byEnd.set(u.end, u); // Korrektur gewinnt (jüngstes filed <= asOf)
    }
  }
  return Array.from(byEnd.values())
    .map((u) => ({ end: u.end, start: u.start || null, val: u.val, filed: u.filed, form: u.form || null, fy: u.fy != null ? u.fy : null, fp: u.fp || null }))
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
}

// Konzept-Auswahl „freshness-first" (Muster enrich-q-revenue.js, MXL-Falle):
// unter den Kandidaten-Konzepten gewinnt das mit dem JÜNGSTEN Perioden-Ende
// in seiner PIT-gefilterten Serie; Serienlänge ist nur Tiebreaker. Rückgabe
// { concept, series } — series [] wenn kein Kandidat etwas liefert.
function pitSeries(companyFacts, concepts, { taxonomy = 'us-gaap', unit = 'USD', asOf, period = 'quarterly' } = {}) {
  const tax = companyFacts && companyFacts.facts && companyFacts.facts[taxonomy];
  let best = { concept: null, series: [] };
  if (!tax) return best;
  for (const c of concepts) {
    const node = tax[c];
    const unitFacts = node && node.units && node.units[unit];
    const series = pitSeriesFromFacts(unitFacts, { asOf, period });
    if (!series.length) continue;
    if (!best.series.length
      || series[0].end > best.series[0].end
      || (series[0].end === best.series[0].end && series.length > best.series.length)) {
      best = { concept: c, series };
    }
  }
  return best;
}

// Aktienanzahl-Historie (dei:EntityCommonStockSharesOutstanding, instant-Fakten
// auf Deckblatt-Basis je Filing) — PIT wie oben: filed <= asOf, je end jüngstes
// filed. Für den Split-Fingerabdruck-Filter und Per-Share-Rechnungen (Katalog).
function sharesHistory(companyFacts, { asOf } = {}) {
  const dei = companyFacts && companyFacts.facts && companyFacts.facts.dei;
  const node = dei && dei.EntityCommonStockSharesOutstanding;
  const units = node && node.units;
  if (!units) return [];
  // Einheit heißt 'shares'; defensiv die erste vorhandene Einheit nehmen.
  const unitFacts = units.shares || units[Object.keys(units)[0]];
  return pitSeriesFromFacts(unitFacts, { asOf, period: 'instant' });
}

// Standard-Konzeptlisten für die B-Backtests (B1: Umsatz+Gewinn-Beschleunigung).
// REV_CONCEPTS deckungsgleich mit enrich-q-revenue.js (dokumentierte Alternativ-Tags).
const REV_CONCEPTS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
];
const NET_INCOME_CONCEPTS = ['NetIncomeLoss'];
const OP_INCOME_CONCEPTS = ['OperatingIncomeLoss'];
const GROSS_PROFIT_CONCEPTS = ['GrossProfit'];

module.exports = {
  openStore, loadTickerMap, cikEntryName,
  pitSeries, pitSeriesFromFacts, sharesHistory,
  isQuarterlyPoint, isAnnualPoint, periodDays,
  REV_CONCEPTS, NET_INCOME_CONCEPTS, OP_INCOME_CONCEPTS, GROSS_PROFIT_CONCEPTS,
  CACHE_DIR, ZIP_PATH, TICKER_INDEX_PATH,
};
