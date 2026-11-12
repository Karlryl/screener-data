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
// entryFilter (optional): (fileName) => boolean. Nur passende Namen landen im
// Index — der „Namensfilter" aus dem D2-Rats-Weg: submissions.zip trägt 988.373
// Einträge, ein ungefilterter Index kostet mehrere hundert MB Heap für nichts.
// Ohne Filter unverändertes Verhalten (companyfacts-Konsumenten B1 ff.).
function buildCentralDirectory(fd, cdOffset, cdSize, entryFilter) {
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
    const keep = !entryFilter || entryFilter(fileName);
    if (!keep) {
      pos += 46 + fnLen + extraLen + commentLen;
      continue;
    }
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
/**
 * Oeffnet den lokalen Companyfacts-ZIP-Store mit einem wiederverwendbaren Dateihandle.
 * @param {string} [zipPath] - ZIP-Pfad; sonst der konfigurierte lokale Standard.
 * @param {{entryFilter?: function(string): boolean}} [options] - Optionaler Filter fuer Verzeichnisnamen.
 * @returns { {zipPath: string, entryCount: number, close: function(): void, hasCik: function(number|string): boolean, entryNames: function(): string[], readEntryByName: function(string): (Buffer|null), factsForCik: function(number|string): (Object|null), cikForTicker: function(string): (number|null), factsForTicker: function(string): (Object|null)} } Store; nach Gebrauch close aufrufen.
 * @throws {Error} ZIP oder Verzeichnis sind nicht lesbar beziehungsweise ungueltig.
 */
function openStore(zipPath, { entryFilter } = {}) {
  const zp = zipPath || ZIP_PATH;
  if (!fs.existsSync(zp)) {
    throw new Error('[sec-pit] companyfacts.zip fehlt: ' + zp
      + ' — Download via scripts/sec-pit-check.js (gratis, sec.gov; SEC_CONTACT nötig).');
  }
  const fd = fs.openSync(zp, 'r');
  // Zwischen openSync und dem fertigen Handle laeuft jetzt fremder Code: der
  // entryFilter des Aufrufers. Wirft er (oder das ZIP ist kaputt), gaebe es ohne
  // dieses catch keinen Weg mehr an den Deskriptor — jeder Fehlversuch liesse
  // einen offenen fd auf einer 1,5-GB-Datei zurueck.
  let dir;
  try {
    const size = fs.fstatSync(fd).size;
    const { cdOffset, cdSize } = findEndOfCentralDir(fd, size);
    dir = buildCentralDirectory(fd, cdOffset, cdSize, entryFilter);
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
  let tickerMap = null; // lazy: Ticker(UPPER) -> CIK (number)
  // Ein gefilterter Store kann "nicht indiziert" nicht von "nicht vorhanden"
  // unterscheiden — hasCik/factsForCik wuerden sonst stumm falsche Negative
  // liefern, und falsche Negative sehen aus wie Daten. Ohne Filter unveraendert.
  //
  // GRENZE DIESER WACHE, damit sie niemand ueberschaetzt: sie erkennt AUSSCHLIESSLICH
  // die vom Filter verursachte Abwesenheit. Faellt ein Eintrag aus einem anderen Grund
  // aus dem Index — bekannt ist der Altfall localOffset === 0xFFFFFFFF ohne passenden
  // ZIP64-Zusatzkopf weiter oben —, laesst der Filter den Namen durch, hier wird nicht
  // geworfen, und hasCik/factsForCik antworten wie bisher still false/null.
  const pruefeIndiziert = (cik) => {
    if (entryFilter && !entryFilter(cikEntryName(cik))) throw new Error('[sec-pit] CIK ' + cik + ' liegt ausserhalb des entryFilter-Index — "nicht indiziert" ist NICHT "nicht vorhanden". Store ohne Filter oeffnen oder den Filter erweitern.');
  };
  return {
    zipPath: zp,
    // Mit aktivem entryFilter zaehlt das die INDIZIERTEN, nicht die im Archiv
    // vorhandenen Eintraege — dasselbe gilt fuer entryNames().
    entryCount: dir.size,
    close() { fs.closeSync(fd); },
    hasCik(cik) { pruefeIndiziert(cik); return dir.has(cikEntryName(cik)); },
    entryNames() { return Array.from(dir.keys()); },
    // Roh-Buffer eines Eintrags (ohne JSON.parse) — erlaubt billige Vorfilter
    // über den unentpackten Text, bevor Megabytes geparst werden.
    readEntryByName(name) {
      const e = dir.get(name);
      return e ? readEntry(fd, e) : null;
    },
    factsForCik(cik) {
      pruefeIndiziert(cik);
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
/**
 * Formatiert eine CIK als zehnstellig aufgefuellten Companyfacts-Dateinamen.
 * @param {number|string} cik - CIK-Kennung.
 * @returns {string} ZIP-Eintragsname CIK0000000000.json.
 */
function cikEntryName(cik) { return 'CIK' + String(cik).padStart(10, '0') + '.json'; }
/**
 * Laedt die lokale SEC-Tickerkarte als Grossbuchstaben-Ticker zu CIK.
 * @param {string} [indexPath] - Pfad zur SEC-Tickerindex-Datei.
 * @returns {Map<string, number>} Tickerzuordnung.
 * @throws {Error} Die Datei fehlt, ist unlesbar oder enthaelt keine brauchbaren Zuordnungen.
 */
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
/**
 * Bestimmt die Tageslaenge eines Facts mit Start- und Enddatum.
 * @param {{start?: string, end?: string}|null} u - Periodenangaben eines SEC-Facts.
 * @returns {number|null} Tagesdifferenz oder null ohne beide Datumsangaben.
 */
function periodDays(u) {
  if (!u || !u.start || !u.end) return null;
  const d = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
  return Number.isFinite(d) ? d : null;
}
/**
 * Erkennt eine Quartalsdauer im eingeschlossenen Band von 80 bis 110 Tagen.
 * @param {{start?: string, end?: string}|null} u - Zu pruefender SEC-Fact.
 * @returns {boolean} Ob die Dauer im Quartalsband liegt.
 */
function isQuarterlyPoint(u) {
  const d = periodDays(u);
  return d != null && d >= QUARTER_MIN_DAYS && d <= QUARTER_MAX_DAYS;
}
/**
 * Erkennt eine Jahresdauer im eingeschlossenen Band von 330 bis 380 Tagen.
 * @param {{start?: string, end?: string}|null} u - Zu pruefender SEC-Fact.
 * @returns {boolean} Ob die Dauer im Jahresband liegt.
 */
function isAnnualPoint(u) {
  const d = periodDays(u);
  return d != null && d >= ANNUAL_MIN_DAYS && d <= ANNUAL_MAX_DAYS;
}

// Aus einer rohen Fakten-Liste (units-Array eines Konzepts) die PIT-Serie zum
// Stichtag bauen: nur filed <= asOf; je Perioden-Ende gewinnt das jüngste filed
// (Tie: jüngere Form-Reihenfolge egal — bei identischem filed nehmen wir den
// später gelisteten Fakt, SEC listet chronologisch). Rückgabe end-absteigend.
/**
 * Waehlt je Periodenende den zum Stichtag bekannten fruehesten oder neuesten Filing-Stand.
 * @param {Array<{start?: string, end: string, val: number, filed: string, form?: string, fy?: number, fp?: string}>} unitFacts - Facts einer Einheit.
 * @param {{asOf: string, period?: string, filedMode?: string}} [options] - Stichtag, quarterly/annual/instant und earliest/latest.
 * @returns {Array<{end: string, start: string|null, val: number, filed: string, form: string|null, fy: number|null, fp: string|null}>} Nach Periodenende absteigend sortierte PIT-Reihe (neuestes zuerst).
 * @throws {Error} Stichtag, Periodenmodus oder Filing-Modus sind ungueltig.
 */
function pitSeriesFromFacts(unitFacts, { asOf, period = 'quarterly', filedMode = 'latest' } = {}) {
  if (!Array.isArray(unitFacts)) return [];
  const accept = period === 'annual' ? isAnnualPoint
    : period === 'quarterly' ? isQuarterlyPoint
    : period === 'instant' ? ((u) => !!u.end && !u.start)
    : null;
  if (!accept) throw new Error('[sec-pit] unbekannte period: ' + period);
  if (filedMode !== 'latest' && filedMode !== 'earliest') throw new Error('[sec-pit] unbekannte filedMode: ' + filedMode);
  const asOfMs = asOf ? Date.parse(asOf) : Infinity;
  if (asOf && !Number.isFinite(asOfMs)) throw new Error('[sec-pit] asOf unlesbar: ' + asOf);
  const byEnd = new Map(); // end -> gewinnender Fakt
  for (const u of unitFacts) {
    if (!u || !Number.isFinite(u.val) || !u.end || !u.filed) continue;
    if (!accept(u)) continue;
    const filedMs = Date.parse(u.filed);
    if (!Number.isFinite(filedMs) || filedMs > asOfMs) continue; // noch nicht bekannt
    const prev = byEnd.get(u.end);
    const replaces = filedMode === 'earliest'
      ? (!prev || Date.parse(u.filed) < Date.parse(prev.filed))
      : (!prev || Date.parse(u.filed) >= Date.parse(prev.filed));
    if (replaces) {
      byEnd.set(u.end, u);
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
/**
 * Waehlt die Konzept-Reihe mit dem neuesten PIT-Periodenende, bei Gleichstand die laengere.
 * @param {Object} companyFacts - SEC-Companyfacts-Objekt mit facts.
 * @param {string[]} concepts - Geordnete Kandidaten fuer den Konzeptnamen.
 * @param {{taxonomy?: string, unit?: string, asOf: string, period?: string, filedMode?: string}} [options] - Taxonomie, Einheit und PIT-Auswahl.
 * @returns { {concept: string|null, series: Array<{end: string, start: string|null, val: number, filed: string, form: string|null, fy: number|null, fp: string|null}>} } Gewaehltes Konzept und Reihe.
 * @throws {Error} Die PIT-Auswahlparameter sind ungueltig.
 */
function pitSeries(companyFacts, concepts, { taxonomy = 'us-gaap', unit = 'USD', asOf, period = 'quarterly', filedMode = 'latest' } = {}) {
  const tax = companyFacts && companyFacts.facts && companyFacts.facts[taxonomy];
  let best = { concept: null, series: [] };
  if (!tax) return best;
  for (const c of concepts) {
    const node = tax[c];
    const unitFacts = node && node.units && node.units[unit];
    const series = pitSeriesFromFacts(unitFacts, { asOf, period, filedMode });
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
/**
 * Liest die zum Stichtag bekannte Aktienanzahl als Instant-Reihe.
 * @param {Object} companyFacts - SEC-Companyfacts-Objekt.
 * @param {{asOf: string}} [options] - Kenntnisstichtag der Filings.
 * @returns {Array<{end: string, start: string|null, val: number, filed: string, form: string|null, fy: number|null, fp: string|null}>} Historische Aktienanzahlen.
 * @throws {Error} Der Kenntnisstichtag ist ungueltig.
 */
function sharesHistory(companyFacts, { asOf } = {}) {
  const dei = companyFacts && companyFacts.facts && companyFacts.facts.dei;
  const node = dei && dei.EntityCommonStockSharesOutstanding;
  const units = node && node.units;
  if (!units) return [];
  // Einheit heißt 'shares'; defensiv die erste vorhandene Einheit nehmen.
  const unitFacts = units.shares || units[Object.keys(units)[0]];
  return pitSeriesFromFacts(unitFacts, { asOf, period: 'instant' });
}

// Quartalsserie MIT abgeleitetem Schluss-Quartal (B1-Protokoll §1: Q4 = FY − Summe
// der 3 diskreten Quartale im Fiskaljahr). Ableitung NUR wenn (a) das Jahresfenster
// echt annual ist (330–380d), (b) exakt 3 diskrete Quartale strikt im Fenster
// liegen, (c) KEIN diskretes Quartal am FY-Ende endet (sonst ist nichts abzuleiten).
// Abgeleiteter Punkt: end = FY-Ende, start = Ende des letzten diskreten Quartals,
// derived:true, filed = max(filed(FY), filed(Q1..Q3)) — bekannt erst, wenn ALLE
// Bestandteile bekannt sind (PIT-sauber). Bewiesen an CRDO (170,0M, Tag 388).
/**
 * Ergaenzt fehlende vierte Quartale aus dem bekannten Jahreswert minus drei diskreten Quartalen.
 * @param {Object} companyFacts - SEC-Companyfacts-Objekt.
 * @param {string[]} concepts - Kandidaten fuer das Umsatz- oder Ergebnis-Konzept.
 * @param {{taxonomy?: string, unit?: string, asOf: string, filedMode?: string}} [options] - Einheit und PIT-Stichtag fuer Quartals- und Jahresfacts.
 * @returns { {concept: string|null, series: Array<Object>} } Quartale einschliesslich mit derived markierter Q4-Werte.
 * @throws {Error} Die PIT-Auswahlparameter sind ungueltig.
 */
function pitQuarterlyWithDerivedQ4(companyFacts, concepts, {
  taxonomy = 'us-gaap', unit = 'USD', asOf, filedMode = 'latest',
} = {}) {
  const tax = companyFacts && companyFacts.facts && companyFacts.facts[taxonomy];
  let best = { concept: null, series: [] };
  if (!tax) return best;
  for (const concept of concepts) {
    const node = tax[concept];
    const unitFacts = node && node.units && node.units[unit];
    const series = pitSeriesFromFacts(unitFacts, { asOf, period: 'quarterly', filedMode });
    const annual = pitSeriesFromFacts(unitFacts, { asOf, period: 'annual', filedMode });
    for (const fy of annual) {
      if (!fy.start) continue;
      if (series.some((p) => p.end === fy.end)) continue;               // (c) letztes Quartal diskret da
      const inFy = series.filter((p) => p.end > fy.start && p.end <= fy.end && !p.derived);
      if (inFy.length !== 3) continue;                                  // (b)
      const filed = [fy, ...inFy].map((p) => p.filed).sort().pop();
      const lastQEnd = inFy.map((p) => p.end).sort().pop();
      series.push({
        end: fy.end, start: lastQEnd, val: fy.val - inFy.reduce((s, p) => s + p.val, 0),
        filed, form: fy.form, fy: fy.fy, fp: 'Q4(derived)', derived: true,
      });
    }
    series.sort((x, y) => (x.end < y.end ? 1 : x.end > y.end ? -1 : 0));
    if (series.length && (!best.series.length
      || series[0].end > best.series[0].end
      || (series[0].end === best.series[0].end && series.length > best.series.length))) {
      best = { concept, series };
    }
  }
  return best;
}

const SINGLE_QUARTER_FORMS = /^10-(Q|K|KT)(\/A)?$/;
// Codex R1 on #85 (3): a filing counts from the first US trading day after its filing day (rule T7), never on the day itself.
// NYSE full-day closures; ponytail: the list ends with 2027, later years fall back to weekdays only (one day early on a holiday).
const NYSE_CLOSED = new Set(['2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19', '2024-07-04', '2024-09-02',
  '2024-11-28', '2024-12-25', '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04',
  '2025-09-01', '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03',
  '2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05',
  '2027-09-06', '2027-11-25', '2027-12-24']);
/** First US trading day after a filing day. @param {string} filed YYYY-MM-DD @returns {string} YYYY-MM-DD */
function effectiveDay(filed) {
  const d = new Date(String(filed).slice(0, 10) + 'T00:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || NYSE_CLOSED.has(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}
/**
 * Whether a filing is known on a data day (its effective day is on or before it).
 * @param {string} filed Filing day YYYY-MM-DD.
 * @param {string} [asOf] Data day YYYY-MM-DD; without one every filing counts.
 * @returns {boolean} true when the filing counts on that day.
 */
const knownOn = (filed, asOf) => !asOf || effectiveDay(filed) <= asOf;
const RESTATEMENT_REL_TOL = 0.005; // a later cumulative figure off by more than 0.5 % against the reported quarter is a restatement
const TILE_GAP_DAYS = 3;           // a reported start is the day after the previous end, a derived one on it; 52/53-week ends shift by a weekend at most
/**
 * Single quarters of one concept from US filings, known at asOf; the latest filing wins per period.
 * A reported three-month fact comes first. Otherwise a cumulative fact minus the earlier cumulative fact with the
 * same start, then a year minus its three quarters. A derived value says how it was derived.
 * @param {Array<{start?: string, end: string, val: number, filed: string, form?: string, accn?: string}>} unitFacts Facts of one unit.
 * @param {{asOf?: string}} [options] Knowledge date.
 * @returns {Array<{end: string, start: string, val: number, filed: string, form: string, accn: string|null, days: number, derivation: string}>} Newest first.
 */
function pitSingleQuarters(unitFacts, { asOf } = {}) {
  if (!Array.isArray(unitFacts)) return [];
  const byPeriod = new Map();
  for (const u of unitFacts) {
    if (!u || !Number.isFinite(u.val) || !u.start || !u.end || !u.filed || !SINGLE_QUARTER_FORMS.test(u.form || '')) continue;
    if (!knownOn(u.filed, asOf)) continue;
    const key = u.start + '|' + u.end, prev = byPeriod.get(key);
    // Codex R1 on #85 (2): the latest filing wins; two different figures filed on the same day leave the period open,
    // whatever their order in the list (identical ones merge).
    if (!prev || u.filed > prev.filed) byPeriod.set(key, u);
    else if (u.filed === prev.filed && !prev.sameDay && Math.abs(u.val - prev.val) > RESTATEMENT_REL_TOL * Math.abs(prev.val)) byPeriod.set(key, { ...prev, sameDay: { val: u.val, accn: u.accn || null } });
  }
  const conflict = (q, at, other) => ({ ...q, filed: at.filed, form: at.form, accn: at.accn || null, derivation: 'restatement-conflict', conflictsWith: other });
  const periods = [...byPeriod.values()], out = new Map();
  const newer = (a, b) => (a > b ? a : b);
  const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;
  for (const u of periods) {
    if (!isQuarterlyPoint(u)) continue;
    const prev = out.get(u.end);
    if (prev && u.filed < prev.filed) continue;
    const q = { end: u.end, start: u.start, val: u.val, filed: u.filed, form: u.form, accn: u.accn || null, days: periodDays(u), derivation: 'reported-3M' };
    out.set(u.end, u.sameDay ? conflict(q, u, u.sameDay) : q);
  }
  const direct = new Map(out);
  for (const y of periods) {
    if (!(periodDays(y) > QUARTER_MAX_DAYS)) continue;
    const d = direct.get(y.end);
    for (const e of periods) {
      const gap = days(e.end, y.end);
      if (e.start !== y.start || !(gap >= QUARTER_MIN_DAYS && gap <= QUARTER_MAX_DAYS)) continue;
      const filed = newer(y.filed, e.filed), val = y.val - e.val, at = y.filed >= e.filed ? y : e;
      if (d) {
        // Codex R21 (2): a later cumulative filing (10-Q/A) that contradicts the older reported quarter is an open
        // restatement. The period gets a marker the reader skips, so it stays empty instead of keeping the older figure.
        // Codex R1 on #85 (1): a later amendment of the subtracted part counts the same way as one of the cumulative figure.
        if (filed > d.filed && Math.abs(val - d.val) > RESTATEMENT_REL_TOL * Math.abs(d.val)) {
          out.set(y.end, conflict({ ...d, val }, at, { val: d.val, filed: d.filed, accn: d.accn }));
        }
        continue;
      }
      const prev = out.get(y.end);
      if (prev && filed < prev.filed) continue;
      if (y.sameDay || e.sameDay) { out.set(y.end, conflict({ end: y.end, start: e.end, val, days: gap }, at, (y.sameDay || e.sameDay))); continue; }
      out.set(y.end, { end: y.end, start: e.end, val, filed, form: y.form, accn: y.accn || null, days: gap, derivation: isAnnualPoint(y) ? 'year-minus-9M' : 'YTD-minus-YTD' });
    }
  }
  for (const y of periods) {
    // Codex R1 on #85 (1): a reported Q4 is checked against a later annual or quarter filing as well, not skipped.
    const d4 = out.get(y.end);
    if ((d4 && d4.derivation !== 'reported-3M') || !isAnnualPoint(y)) continue;
    const inYear = [...out.values()].filter((q) => q.end > y.start && q.end < y.end).sort((a, b) => (a.end < b.end ? -1 : 1));
    // Codex R21 (2): the three quarters must tile the first nine months without gap or overlap, and the rest must itself
    // be a quarter; three overlapping periods up to June would otherwise leave a "fourth quarter" of 184 days.
    if (inYear.length !== 3 || inYear.some((q) => q.derivation === 'restatement-conflict')) continue;
    // A reported quarter starts the day after the previous end, a derived one on it: 0 or 1 day, never back in time.
    const tiles = inYear.every((q, i) => {
      const step = days(i ? inYear[i - 1].end : y.start, q.start);
      return q.days >= QUARTER_MIN_DAYS && q.days <= QUARTER_MAX_DAYS && (i ? step >= 0 && step <= TILE_GAP_DAYS : Math.abs(step) <= TILE_GAP_DAYS);
    });
    const last = inYear[2].end, rest = days(last, y.end);
    if (!tiles || !(rest >= QUARTER_MIN_DAYS && rest <= QUARTER_MAX_DAYS)) continue;
    const val = y.val - inYear.reduce((a, q) => a + q.val, 0), filed = inYear.reduce((a, q) => newer(a, q.filed), y.filed);
    if (d4) {
      if (filed > d4.filed && Math.abs(val - d4.val) > RESTATEMENT_REL_TOL * Math.abs(d4.val)) out.set(y.end, conflict({ ...d4, val }, filed === y.filed ? y : inYear.find((q) => q.filed === filed), { val: d4.val, filed: d4.filed, accn: d4.accn }));
      continue;
    }
    if (y.sameDay) { out.set(y.end, conflict({ end: y.end, start: last, val, days: rest }, y, y.sameDay)); continue; }
    out.set(y.end, { end: y.end, start: last, val, filed, form: y.form, accn: y.accn || null, days: rest, derivation: 'year-minus-three-quarters' });
  }
  return [...out.values()].sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
}

// YoY-Partner nach B1-Protokoll §1: gleiches Fiskalquartal des Vorjahres = der
// Punkt, dessen Ende am nächsten an end−365d liegt, innerhalb ±35 Tagen
// (deterministische Realisierung der Fiskalquartal-Index-Paarung; Transition-/
// 53-Wochen-Verwerfungen zählt der Aufrufer).
/**
 * Sucht das naechste Periodenende ein Jahr vor einem Punkt innerhalb der 35-Tage-Toleranz.
 * @param {Array<{end: string, start: string|null, val: number, filed: string, form: string|null, fy: number|null, fp: string|null}>} series - Moegliche Vergleichspunkte.
 * @param {{end: string}} point - Aktueller Periodenpunkt.
 * @returns {Object|null} Vergleichspunkt oder null ohne passenden Vorjahreswert.
 */
function yoyPartner(series, point) {
  const target = Date.parse(point.end) - 365 * 86400000;
  let best = null, bestDev = Infinity;
  for (const p of series) {
    if (p.end >= point.end) continue;
    const dev = Math.abs(Date.parse(p.end) - target);
    if (dev < bestDev) { bestDev = dev; best = p; }
  }
  return (best && bestDev <= 35 * 86400000) ? best : null;
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
  pitQuarterlyWithDerivedQ4, pitSingleQuarters, yoyPartner, effectiveDay, knownOn,
  isQuarterlyPoint, isAnnualPoint, periodDays, QUARTER_MIN_DAYS, QUARTER_MAX_DAYS,
  REV_CONCEPTS, NET_INCOME_CONCEPTS, OP_INCOME_CONCEPTS, GROSS_PROFIT_CONCEPTS,
  CACHE_DIR, ZIP_PATH, TICKER_INDEX_PATH,
};
