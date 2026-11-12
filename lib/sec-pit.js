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
// Codex R2 (P2-3): the NYSE full-day closures follow the exchange's rules for every year instead of a list ending in 2027:
// New Year (a Saturday is not moved to the Friday before), Martin Luther King Jr. Day, Washington's Birthday, Good Friday,
// Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas (Saturday to Friday, Sunday to Monday).
// Unscheduled closures are listed by hand (09.01.2025, national day of mourning).
const NYSE_EXTRA_CLOSED = new Set(['2025-01-09']);
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, day) => new Date(Date.UTC(y, m, day));
const nthWeekday = (y, m, wd, n) => { const d = utc(y, m, 1); d.setUTCDate(1 + ((wd - d.getUTCDay() + 7) % 7) + 7 * (n - 1)); return d; };
const lastWeekday = (y, m, wd) => { const d = utc(y, m + 1, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7)); return d; };
const observed = (d) => { const w = d.getUTCDay(); if (w === 6) d.setUTCDate(d.getUTCDate() - 1); else if (w === 0) d.setUTCDate(d.getUTCDate() + 1); return d; };
function easterSunday(y) { // Anonymous Gregorian algorithm (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utc(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const closedYears = new Map();
/**
 * NYSE full-day closures of one year by the exchange's holiday rules.
 * @param {number} y Year. @returns {Set<string>} Closed days YYYY-MM-DD.
 */
function nyseClosed(y) {
  if (closedYears.has(y)) return closedYears.get(y);
  const goodFriday = easterSunday(y); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  const newYear = utc(y, 0, 1), days = [goodFriday, nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), lastWeekday(y, 4, 1), nthWeekday(y, 8, 1, 1),
    nthWeekday(y, 10, 4, 4), observed(utc(y, 6, 4)), observed(utc(y, 11, 25))];
  if (newYear.getUTCDay() === 0) newYear.setUTCDate(2);
  if (newYear.getUTCDay() !== 6) days.push(newYear);
  if (y >= 2022) days.push(observed(utc(y, 5, 19)));
  const out = new Set(days.map(iso));
  closedYears.set(y, out);
  return out;
}
/** First US trading day after a filing day. @param {string} filed YYYY-MM-DD @returns {string} YYYY-MM-DD */
function effectiveDay(filed) {
  const d = new Date(String(filed).slice(0, 10) + 'T00:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || nyseClosed(d.getUTCFullYear()).has(iso(d)) || NYSE_EXTRA_CLOSED.has(iso(d)));
  return iso(d);
}
/**
 * Whether a filing is known on a data day (its effective day is on or before it).
 * @param {string} filed Filing day YYYY-MM-DD.
 * @param {string} [asOf] Data day YYYY-MM-DD; without one every filing counts (the board reader passes a day or holds).
 * @returns {boolean} true when the filing counts on that day.
 */
const knownOn = (filed, asOf) => !asOf || effectiveDay(filed) <= asOf;
// Two figures of one span further apart than 0.02 % of the larger one disagree. Master 12.11.2026 (blind delta check N1): with
// 0.5 % a year restated by 0.47 % passed as equal and moved a derived fourth quarter by about 2 growth points; 0.02 % keeps the
// growth error under 0.1 points also for a year minus three quarters (about four times the relative gap). SEC companyfacts carry
// no rounding precision per fact, so rounding by the filer is not inferred.
const RESTATEMENT_REL_TOL = 0.0002;
const TILE_GAP_DAYS = 3;           // a reported start is the day after the previous end, a derived one on it; 52/53-week ends shift by a weekend at most
/** Whether two figures disagree, the same in both orders (Codex R2 P1-1: the tolerance is relative to the larger amount). */
const disagree = (a, b) => Math.abs(a - b) > RESTATEMENT_REL_TOL * Math.max(Math.abs(a), Math.abs(b));
const DERIVATION_ORDER = ['reported-3M', 'YTD-minus-YTD', 'year-minus-9M', 'year-minus-three-quarters'];
/**
 * Single quarters of one concept from US filings, known at asOf. Fail-closed (Codex R2 on #85, P1-1 and P1-2): a period
 * with two different figures (any filing day, any order) is contested; a quarter end gets one figure only when every way
 * to reach it (a reported three-month fact, a cumulative minus the earlier cumulative with the same start, a year minus
 * its three quarters) agrees and touches no contested period. Otherwise the end gets a restatement-conflict marker dated
 * by the newest filing involved, so an append-only store holding an older figure for that end leaves it open from then on.
 * @param {Array<{start?: string, end: string, val: number, filed: string, form?: string, accn?: string}>} unitFacts Facts of one unit.
 * @param {{asOf?: string}} [options] Knowledge date.
 * @returns {Array<{end: string, start: string, val: number, filed: string, form: string, accn: string|null, days: number, derivation: string}>} Newest first.
 */
function pitSingleQuarters(unitFacts, { asOf } = {}) {
  if (!Array.isArray(unitFacts)) return [];
  const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;
  const facts = unitFacts.filter((u) => u && Number.isFinite(u.val) && u.start && u.end && u.filed && SINGLE_QUARTER_FORMS.test(u.form || '') && knownOn(u.filed, asOf))
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  // One period per exact start and end. Codex R3 and the blind delta check of 12.11. (M1, M2): two facts whose start days AND end
  // days each lie at most TILE_GAP_DAYS apart describe the same span (01.04. and 02.04., 29.06. and 30.06.); every such pair is
  // compared, so no grouping edge, no chain of agreeing facts and no order can hide a contradiction.
  const byKey = new Map();
  for (const u of facts) { const k = u.start + '|' + u.end; (byKey.get(k) || byKey.set(k, []).get(k)).push(u); }
  const near = (a, b) => Math.abs(days(a.start, b.start)) <= TILE_GAP_DAYS && Math.abs(days(a.end, b.end)) <= TILE_GAP_DAYS;
  const clash = new Map(); // key -> a contradicting figure from the same span
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i], b = facts[j];
      if (days(a.end, b.end) > TILE_GAP_DAYS) break; // facts are sorted by end, so no later fact is near
      if (!near(a, b) || !disagree(a.val, b.val)) continue;
      for (const [x, y] of [[a, b], [b, a]]) { const k = x.start + '|' + x.end; if (!clash.has(k)) clash.set(k, y); }
    }
  }
  // One entry per period: its figure dated by the first filing that reported it, or contested (dated by the newest filing involved).
  const periods = [...byKey.entries()].map(([key, list]) => {
    // Order-free: filing day, then file number, then start, then the figure itself (same answer in every input order).
    const sorted = [...list].sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : String(a.accn || '') < String(b.accn || '') ? -1
      : String(a.accn || '') > String(b.accn || '') ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : a.val - b.val));
    const first = sorted[0], other = clash.get(key) || null, contested = !!other;
    const last = contested ? [...sorted, other].reduce((a, x) => (x.filed > a.filed ? x : a)) : sorted[sorted.length - 1];
    return { start: first.start, end: first.end, val: first.val, filed: contested ? last.filed : first.filed,
      form: (contested ? last : first).form, accn: (contested ? last : first).accn || null, contested, other: contested ? other.val : null };
  });
  const newest = (xs) => xs.reduce((a, x) => (x.filed > a.filed ? x : a));
  const ends = [...new Set(periods.map((p) => p.end))].sort();
  const out = new Map();
  for (const end of ends) {
    const ways = [];   // {val, derivation, start, days, parts}
    for (const u of periods) if (u.end === end && isQuarterlyPoint(u)) ways.push({ val: u.val, derivation: 'reported-3M', start: u.start, days: periodDays(u), parts: [u] });
    for (const y of periods) {
      if (y.end !== end || !(periodDays(y) > QUARTER_MAX_DAYS)) continue;
      for (const e of periods) {
        const gap = days(e.end, y.end);
        if (e.start !== y.start || !(gap >= QUARTER_MIN_DAYS && gap <= QUARTER_MAX_DAYS)) continue;
        ways.push({ val: y.val - e.val, derivation: isAnnualPoint(y) ? 'year-minus-9M' : 'YTD-minus-YTD', start: e.end, days: gap, parts: [y, e] });
      }
      if (!isAnnualPoint(y)) continue;
      const inYear = [...out.values()].filter((q) => q.end > y.start && q.end < y.end).sort((a, b) => (a.end < b.end ? -1 : 1));
      // Codex R21 (2): the three quarters must tile the first nine months without gap or overlap, and the rest must itself be a quarter.
      if (inYear.length !== 3) continue;
      const tiles = inYear.every((q, i) => {
        const step = days(i ? inYear[i - 1].end : y.start, q.start);
        return q.days >= QUARTER_MIN_DAYS && q.days <= QUARTER_MAX_DAYS && (i ? step >= 0 && step <= TILE_GAP_DAYS : Math.abs(step) <= TILE_GAP_DAYS);
      });
      const last = inYear[2].end, rest = days(last, y.end);
      if (!tiles || !(rest >= QUARTER_MIN_DAYS && rest <= QUARTER_MAX_DAYS)) continue;
      ways.push({ val: y.val - inYear.reduce((a, q) => a + q.val, 0), derivation: 'year-minus-three-quarters', start: last, days: rest, parts: [y, ...inYear] });
    }
    if (!ways.length) continue;
    const parts = ways.flatMap((w) => w.parts), at = newest(parts);
    // Codex R3 on #85 (P1-A): a quarter-long part counts as open when its own end already is (a conflict marker in out), also when
    // it enters as a raw period in a cumulative difference.
    const open = parts.find((p) => p.contested || p.derivation === 'restatement-conflict' || (isQuarterlyPoint(p) && p.end < end && out.get(p.end)?.derivation === 'restatement-conflict'));
    const wv = ways.map((w) => w.val), wlo = Math.min(...wv), whi = Math.max(...wv);
    const split = disagree(wlo, whi) ? ways.find((w) => w.val === (ways[0].val === wlo ? whi : wlo)) : null;
    if (open || split) {
      out.set(end, { end, start: ways[0].start, val: ways[0].val, filed: at.filed, form: at.form, accn: at.accn || null, days: ways[0].days, derivation: 'restatement-conflict',
        conflictsWith: open ? { val: open.contested ? open.other : open.val, filed: open.filed, accn: open.accn || null } : { val: split.val, filed: newest(split.parts).filed, accn: newest(split.parts).accn || null } });
      continue;
    }
    // All ways agree: the most direct one stands, dated by the newest filing it needs.
    const w = [...ways].sort((a, b) => DERIVATION_ORDER.indexOf(a.derivation) - DERIVATION_ORDER.indexOf(b.derivation)
      || (a.start < b.start ? -1 : a.start > b.start ? 1 : a.val - b.val))[0], src = newest(w.parts);
    out.set(end, { end, start: w.start, val: w.val, filed: src.filed, form: w.parts[0].form, accn: w.parts[0].accn || null, days: w.days, derivation: w.derivation });
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
