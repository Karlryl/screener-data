#!/usr/bin/env node
/**
 * TMX Canada (Toronto Stock Exchange + TSX Venture) full listed-issuer register.
 * =============================================================================
 * Source: TMX publishes the complete monthly issuer list as a single XLSX,
 * keyless, from its "Current Market Statistics" page (live-verified 2026-07-03):
 *   https://www.tsx.com/en/resource/571  ("TSX & TSXV Listed Companies")
 *
 * The workbook has two sheets — sheet1 = TSX issuers, sheet2 = TSXV issuers —
 * plus the usual sharedStrings table. Both sheets carry a real header row
 * (row 10) with columns Exchange / Name / "Root Ticker" / "Listing Date";
 * data starts row 11. The two sheets do NOT share a column layout, so columns
 * are matched by header NAME (like edinet-jp.js), not fixed index — a column
 * reshuffle in a future month won't corrupt the parse.
 *
 * The register is a VOLLREGISTER: it lists every issuer incl. that month's new
 * IPOs (verified: rows for 2025/2026 listings are present), so it catches a
 * young CRDO/ALAB-analogue, not just an index.
 *
 * yahooTicker: TMX writes dual-class / preferred / CPC tickers with a dot
 * (BBD.B, FIVD.P). Yahoo rewrites that dot as a hyphen and appends the venue
 * suffix — verified live against Yahoo search: BBD.B -> BBD-B.TO. So:
 *   root.replace(/\./g,'-') + (exchange === 'TSXV' ? '.V' : '.TO')
 *
 * XLSX = a ZIP of XML. Read with Node built-ins only (zlib.inflateRawSync on the
 * DEFLATE entries) via a minimal central-directory reader — no npm dep. This is
 * the multi-entry sibling of edinet-jp.js's single-entry unzip.
 *
 * marketCap intentionally NOT set (Yahoo fills it later), per the contract.
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country, ipoDate?}>.
 * Fail-silent: any error -> empty Map marked partial (never throws), per the
 * discovery contract.
 */
'use strict';
const https = require('https');
const zlib = require('zlib');

const REGISTER_URL = 'https://www.tsx.com/en/resource/571';
const REFERER = 'https://www.tsx.com/en/listings/current-market-statistics';
const MAX_REDIRECTS = 5;

// mirror finnhub.js / edinet-jp.js redirect hardening: cap recursion, resolve
// relative Location, follow 301/302/307/308, drain bodies to avoid socket leaks.
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (screener-data)',
        'Referer': REFERER,
        'Accept': '*/*',
      },
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume();
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' without Location header'));
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        let nextUrl;
        try { nextUrl = new URL(loc, url).toString(); }
        catch (e) { return reject(new Error('invalid redirect Location: ' + loc)); }
        return get(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Minimal multi-entry ZIP reader: walk the End-of-Central-Directory + central
// directory, inflate each needed DEFLATE entry. XLSX has >1 entry so the
// fixed-single-header trick from edinet-jp.js isn't enough; this reads the CD.
// ponytail: only decodes the entries we ask for by name; ZIP64 not handled —
// the TMX file is ~0.5MB, far below the 4GB ZIP64 threshold. Upgrade path: read
// the ZIP64 EOCD locator if a file ever exceeds 0xFFFFFFFF.
function readZipEntries(buf, wanted) {
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no EOCD (not an XLSX/ZIP)');
  const cdCount = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);
  const want = new Set(wanted);
  const out = {};
  for (let n = 0; n < cdCount && want.size > 0; n++) {
    if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error('bad central-directory signature');
    const method = buf.readUInt16LE(cdOff + 10);
    const compSize = buf.readUInt32LE(cdOff + 20);
    const nameLen = buf.readUInt16LE(cdOff + 28);
    const extraLen = buf.readUInt16LE(cdOff + 30);
    const commentLen = buf.readUInt16LE(cdOff + 32);
    const lho = buf.readUInt32LE(cdOff + 42);
    const name = buf.toString('utf8', cdOff + 46, cdOff + 46 + nameLen);
    if (want.has(name)) {
      // Local header extra field length can differ from the central one — read it.
      const lNameLen = buf.readUInt16LE(lho + 26);
      const lExtraLen = buf.readUInt16LE(lho + 28);
      const dataStart = lho + 30 + lNameLen + lExtraLen;
      const comp = buf.slice(dataStart, dataStart + compSize);
      out[name] = method === 0 ? comp : zlib.inflateRawSync(comp);
      want.delete(name);
    }
    cdOff += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

// sharedStrings.xml: one <si> per string; a string can be split across several
// <t> runs (rich text) which we concatenate.
function parseSharedStrings(xml) {
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t, s = '';
    while ((t = tRe.exec(m[1]))) s += t[1];
    strings.push(decodeXmlEntities(s));
  }
  return strings;
}

const colLetters = ref => ref.replace(/[0-9]+$/, '');

// Parse one <row> into { colLetter: value }. Handles shared strings (t="s"),
// inline strings (t="inlineStr"), and plain numeric/date cells.
function parseRow(rowXml, strings) {
  const cells = {};
  const cRe = /<c r="([A-Z]+\d+)"((?:\s+[^>]*?)?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cRe.exec(rowXml))) {
    const ref = cm[1];
    const attrs = cm[2] || '';
    const body = cm[3];
    if (body === undefined) continue; // self-closed empty cell
    const typeMatch = /\bt="([^"]*)"/.exec(attrs);
    const type = typeMatch ? typeMatch[1] : null;
    let val;
    if (type === 'inlineStr') {
      const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
      val = tm ? decodeXmlEntities(tm[1]) : '';
    } else {
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
      if (!vm) continue;
      if (type === 's') val = strings[parseInt(vm[1], 10)];
      else val = decodeXmlEntities(vm[1]);
    }
    if (val !== undefined) cells[colLetters(ref)] = val;
  }
  return cells;
}

// TMX "Listing Date" is 'YYYYMMDD'; emit 'YYYY-MM-DD' or undefined if malformed.
function toIpoDate(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{8}$/.test(s)) return undefined;
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

// audit/fix BH-063: TMX writes the SAME dot-suffix convention for dual-class
// COMMON shares (BBD.B) and for non-common instruments — preferred (.PR,
// .PR.A/.PR.B series), CPC shells (.P) and warrants/rights (.WT/.RT). Only
// the dual-class-common form belongs in an equity universe; Yahoo tags many
// preferreds as EQUITY too, so downstream mcap-prefilter's quoteType filter
// doesn't reliably catch them. Drop the non-common suffixes at the source,
// analogous to the subtype:'common' filter in tv-scanner.js.
const NON_COMMON_SUFFIX_RE = /\.(?:PR(?:\.[A-Z]+)?|PF|P|WT|RT)$/i;

// BA-SC-001 Stufe 1: das TMX-Register ist ein VOLLREGISTER aller listed issuers —
// darin stehen neben Firmen auch Vehikel, die nie eine Aktie werden koennen und die
// der Suffix-Filter oben nicht sieht, weil sie voellig normale Root-Ticker tragen:
// CDRs (kanadische Zertifikate auf US-Aktien: "Apple CDR (CAD Hedged)" -> AAPL.TO),
// ETFs/ETNs, physische Metall-Treuhaender (Sprott PHYS/PSLV/CEF/COP/U), Geldmarkt-,
// T-Bill- und Anleihefonds. Sie tragen nur ein Merkmal: den Namen.
// Gemessen 2026-08-03: 1336 von 3603 Registerzeilen sind solche Vehikel, 45 davon
// lagen bereits im Bestand (watchlist.json, added_via~tsx). Jede kostet einen
// Yahoo-Abruf und verzerrt den Universums-Nenner. Fundamentals fangen sie spaeter
// ohnehin ab — das hier ist Hygiene am Zufluss, kein Scoring.
//
// BEWUSST NUR diese sechs Klassen. Ein generischer Fund/Trust/REIT-Filter (Stufe 2)
// ist NICHT gebaut: er wuerde operative Firmen im Trust-Mantel erschlagen
// (Chemtrade Logistics Income Fund, Boston Pizza Royalties Income Fund) und die
// gesamte kanadische REIT-Landschaft. Jede Alternative unten braucht darum einen
// harten, mehrteiligen Anker statt eines Substring-Treffers.
const NON_STOCK_NAME_RE = new RegExp([
  '\\bCDRs?\\b',                                  // Canadian Depositary Receipt
  '\\b(?:ETFs?|ETNs?)\\b',                        // Exchange Traded Fund / Note
  // Physischer Metall-Treuhaender: verlangt ALLE drei Bestandteile (Physical +
  // Metall + Trust/Fund). "Precious Metals and Mining Trust" (aktiv gemanagter
  // Minen-Fonds) und jeder operative Minenbetreiber bleiben damit unberuehrt.
  '\\bPhysical\\b(?=.*\\b(?:Gold|Silver|Platinum|Palladium|Copper|Uranium|Bullion|Metals?)\\b)(?=.*\\b(?:Trust|Fund)\\b)',
  // Geldmarkt: "Money Market"/"Cash Management" allein koennte ein Dienstleister
  // sein, darum zusaetzlich ein Vehikel-Wort dahinter.
  // Tag 554: das Vehikel-Wort muss DANEBEN stehen. Vorher stand hier
  // `(?=.*\b(?:Fund|Trust|Portfolio|Class)\b)` — der Lookahead durchsuchte den
  // ganzen Reststring, als einzige der sechs Regeln ohne Naehe-Bindung, und
  // "Class" war ausserdem gar kein Vehikel-Wort, sondern die Aktiengattung.
  // "Meridian Money Market Innovations Inc., Class A Subordinate Voting Shares"
  // flog damit als Fonds. Fenster 3 Woerter (gemessen: alle echten Vehikel
  // tragen ihr Wort direkt dahinter, "Purpose USD Cash Management Fund" mit 0).
  '\\b(?:Money Market|Cash Management)\\b(?=(?:\\s+\\S+){0,3}\\s+(?:Fund|Trust|Portfolio)\\b)',
  '\\bT-Bills?\\b|\\bTreasury Bills?\\b',
  '\\bBond (?:Fund|Trust)\\b',                    // "Bond" allein waere zu breit
].join('|'), 'i');

// Ertrags-Untergrenze (BA-SC-001): ein Namensfilter, der ploetzlich fast die ganze
// Ausbeute frisst, ist kein Hygiene-Effekt mehr, sondern der Verdacht auf Layout-
// Drift — etwa eine Spaltenverschiebung, nach der der "Name" aus einer Spalte
// kommt, in der bei jeder Zeile "ETF" steht. Der Auftrag nannte 30 %; die Messung
// vom 2026-08-03 widerlegt das als Schwelle: 1336/3603 = 37,1 % des Registers SIND
// Fondsvehikel, eine 30 %-Schwelle haette bei jedem gesunden Lauf gefeuert und die
// Warnung wertlos gemacht. Darum 55 % — ~18 Punkte Luft ueber dem Normalstand und
// weit unter dem "matcht auf alles"-Fall (~100 %). Kein Abbruch, nur Warnung.
const NAME_FILTER_WARN_RATIO = 0.55;

// Zaehlzeile + optionale Warnung als reine Funktion, damit die Schwelle einzeln
// pruefbar ist (in fetchTsxCanada saesse sie hinter dem Netzaufruf).
function nameFilterLines(dropped, seen) {
  const lines = [`  [TSX-CA] TSX-Namensfilter: ${dropped} von ${seen} gedroppt (Stufe 1)`];
  if (seen > 0 && dropped / seen > NAME_FILTER_WARN_RATIO) {
    lines.push(`::warning::[TSX-CA] Namensfilter frisst ${(dropped / seen * 100).toFixed(1)} % der ` +
      `Discovery-Ausbeute (${dropped}/${seen}, Schwelle ${(NAME_FILTER_WARN_RATIO * 100).toFixed(0)} %) — ` +
      `Layout-Drift im TMX-Register? Namensspalte pruefen.`);
  }
  return lines;
}

// TMX root ticker -> Yahoo symbol. TMX uses '.' for class/preferred/CPC suffixes
// (BBD.B); Yahoo rewrites that as '-' and appends the venue suffix.
// Verified live: BBD.B -> BBD-B.TO.
function toYahooTicker(root, exchange) {
  const r = String(root || '').toUpperCase().trim();
  if (!r) return null;
  if (!/^[A-Z0-9][A-Z0-9.\-]*$/.test(r)) return null; // guard junk
  const suffix = exchange === 'TSXV' ? '.V' : '.TO';
  return r.replace(/\./g, '-') + suffix;
}

// Find the header row (the row whose cells include Exchange + Name + a
// Root/Ticker column) and return the column-letter for each field we need.
// Header labels contain embedded newlines ("Root\nTicker"), so match loosely.
function locateColumns(rows, strings) {
  for (const rowXml of rows) {
    const cells = parseRow(rowXml, strings);
    const byNorm = {};
    for (const [col, val] of Object.entries(cells)) {
      byNorm[col] = String(val).replace(/\s+/g, ' ').trim().toLowerCase();
    }
    const find = pred => Object.keys(byNorm).find(col => pred(byNorm[col]));
    const cExchange = find(v => v === 'exchange');
    const cName = find(v => v === 'name');
    const cTicker = find(v => v === 'root ticker' || v === 'ticker' || v === 'root');
    if (cExchange && cName && cTicker) {
      const cDate = find(v => v === 'listing date');
      return { cExchange, cName, cTicker, cDate };
    }
  }
  return null;
}

function parseSheet(sheetXml, strings, result, stats = { seen: 0, dropped: 0 }) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml))) rows.push(rm[1]);
  if (rows.length === 0) return 0;

  const cols = locateColumns(rows, strings);
  if (!cols) return 0; // header not found -> skip this sheet, don't corrupt

  let added = 0, headerSeen = false;
  for (const rowXml of rows) {
    const cells = parseRow(rowXml, strings);
    const exch = String(cells[cols.cExchange] || '').trim().toUpperCase();
    // Skip until past the header; header row's Exchange cell literally says "Exchange".
    if (!headerSeen) {
      if (exch === 'EXCHANGE') { headerSeen = true; }
      continue;
    }
    if (exch !== 'TSX' && exch !== 'TSXV') continue; // banner/blank/summary rows
    const root = cells[cols.cTicker];
    // audit/fix BH-063: preferred/CPC/warrant/right suffix -> not common equity, drop.
    if (NON_COMMON_SUFFIX_RE.test(String(root || '').trim())) continue;
    // BA-SC-001 Stufe 1: Nicht-Aktien am Namen abfangen. Gezaehlt, nicht still
    // gedroppt — fetchTsxCanada meldet die Quote und warnt bei Layout-Drift.
    const name = String(cells[cols.cName] || '').trim();
    stats.seen++;
    if (NON_STOCK_NAME_RE.test(name)) { stats.dropped++; continue; }
    const yahoo = toYahooTicker(root, exch);
    if (!yahoo) continue;
    if (result.has(yahoo)) continue;
    const info = {
      ticker: yahoo,
      name,
      exchange: exch,
      source: 'tsx',
      country: 'Canada',
    };
    const ipo = cols.cDate ? toIpoDate(cells[cols.cDate]) : undefined;
    if (ipo) info.ipoDate = ipo;
    result.set(yahoo, info);
    added++;
  }
  return added;
}

async function fetchTsxCanada(options = {}) {
  const getImpl = options.get || get;
  const readEntries = options.readZipEntries || readZipEntries;
  const log = options.log || console.log;
  const result = new Map();
  try {
    log('  [TSX-CA] Fetching TMX listed-companies register (XLSX)...');
    const xlsx = await getImpl(REGISTER_URL);
    const entries = readEntries(xlsx, [
      'xl/sharedStrings.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    const strings = entries['xl/sharedStrings.xml']
      ? parseSharedStrings(entries['xl/sharedStrings.xml'].toString('utf8'))
      : [];
    let tsxCount = 0, tsxvCount = 0;
    const nameStats = { seen: 0, dropped: 0 };
    if (entries['xl/worksheets/sheet1.xml']) {
      tsxCount = parseSheet(entries['xl/worksheets/sheet1.xml'].toString('utf8'), strings, result, nameStats);
    }
    if (entries['xl/worksheets/sheet2.xml']) {
      tsxvCount = parseSheet(entries['xl/worksheets/sheet2.xml'].toString('utf8'), strings, result, nameStats);
    }
    log(`  [TSX-CA] TSX ${tsxCount} + TSXV ${tsxvCount} = ${result.size} issuers`);
    for (const line of nameFilterLines(nameStats.dropped, nameStats.seen)) log(line);
    // audit/fix BH-061: a missing sheet entry or an unlocatable header row
    // (locateColumns returns null) silently yields 0 for that venue while the
    // OTHER sheet still keeps the whole Map nonempty/green — no contract check
    // caught a workbook reshuffle. Both venues are always present in a healthy
    // pull, so 0 on either one is a loud signal, not a normal outcome.
    if (tsxCount === 0 || tsxvCount === 0) {
      console.warn(`  [TSX-CA] WARNING: TSX=${tsxCount} TSXV=${tsxvCount} — one venue yielded zero issuers (header not found / sheet reshuffled?). Register is PARTIAL.`);
      result.partial = true;
    }
  } catch (e) {
    console.error('  [TSX-CA] failed: ' + e.message);
    const failed = new Map();
    failed.partial = true;
    return failed; // fail-silent per contract; refresh-universe sees degradation
  }
  return result;
}

module.exports = {
  fetchTsxCanada, NON_COMMON_SUFFIX_RE, toYahooTicker,
  parseSheet, NON_STOCK_NAME_RE, nameFilterLines, NAME_FILTER_WARN_RATIO,
};

if (require.main === module) {
  fetchTsxCanada().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 10);
    for (const info of sample) {
      console.log(' ', info.ticker, '-', info.name, '(', info.exchange, info.ipoDate || '?', ')');
    }
  }).catch(console.error);
}
