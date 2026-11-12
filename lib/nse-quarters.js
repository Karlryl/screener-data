'use strict';
/** NSE quarterly revenue: pure selection, parsing and append-only storage helpers. */
const crypto = require('node:crypto');
const A = require('../scripts/build-inannual');
const S = require('./exchange-quarter-store');
const FINANCIALS = 'Integrated Filing- Financials';
const BASIS = 'https://www.nseindia.com';
const ARCHIVE = 'nsearchives.nseindia.com';
const END = /^\d{4}-(03-31|06-30|09-30|12-31)$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9&.-]{0,39}$/;

/** Validate a calendar date, without Date.parse's invalid-day rollover.
 * @param {string} value ISO calendar date */
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Parse an exchange timestamp in India Standard Time, not the machine timezone.
 * @param {string} value NSE timestamp */
function timestamp(value) {
  const m = /^(\d{1,2}-[A-Za-z]{3}-\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value || '');
  const day = m && A.nseDatum(m[1]);
  if (!validDate(day) || +m[2] > 23 || +m[3] > 59 || +m[4] > 59) return null;
  return { day, ms: Date.parse(`${day}T${m[2]}:${m[3]}:${m[4]}+05:30`) };
}

/** Restrict filing downloads to the exchange archive, with no redirect or credentials.
 * @param {string} url filing URL */
function archiveUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Ungueltige XBRL-Adresse'); }
  if (u.protocol !== 'https:' || u.hostname !== ARCHIVE || u.port || u.username || u.password
      || u.search || u.hash || !/^\/corporate\/xbrl\/[A-Za-z0-9_.-]+\.xml$/.test(u.pathname)) {
    throw new Error('XBRL-Adresse liegt nicht im erlaubten NSE-Archiv');
  }
  return u.href;
}

/** Select the latest revision of each quarter's own consolidated financial filing.
 * @param {object|Array} payload exact integrated-filing-results response
 * @param {string} symbol NSE symbol
 * @param {string} asOf last allowed observation date */
function selectFilings(payload, symbol, asOf) {
  if (!SYMBOL.test(symbol) || !validDate(asOf)) throw new Error('Symbol oder Stichtag ungueltig');
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('NSE-Antwort ohne data-Liste');
  if (!Array.isArray(payload) && (!Number.isInteger(payload.totalCount)
      || payload.totalCount > rows.length)) throw new Error('NSE-Liste unvollstaendig oder abgeschnitten');
  const selected = new Map();
  for (const row of rows) {
    if (row.type !== FINANCIALS || row.consolidated !== 'Consolidated') continue;
    if (row.symbol !== symbol) throw new Error('Fremdes Symbol in NSE-Liste');
    const end = A.nseDatum(row.qe_Date);
    if (!validDate(end) || !END.test(end)) throw new Error('Ungueltiger Quartalsstichtag');
    if (end > asOf) continue;
    if (!['Original', 'Revised', 'Revision'].includes(row.type_Sub)) throw new Error('Unbekannte Meldungsfassung');
    if (!/^\d+$/.test(String(row.seq_Id))) throw new Error('Meldungskennung fehlt');
    const times = ['broadcast_Date', 'creation_Date', 'revised_Date'].map(k => {
      if (row[k] == null || row[k] === '') return null;
      const t = timestamp(row[k]);
      if (!t) throw new Error('Unlesbare Meldungszeit: ' + k);
      return t;
    }).filter(Boolean);
    if (!times.length) throw new Error('Meldungszeit fehlt');
    const latest = times.reduce((a, b) => a.ms >= b.ms ? a : b);
    const broadcast = timestamp(row.broadcast_Date);
    if (latest.day > asOf) continue;
    if (latest.day < end || (broadcast && broadcast.day < end)) throw new Error('Meldung vor Quartalsende');
    const filing = {
      symbol, periodEnd: end, url: archiveUrl(row.xbrl), filingId: String(row.seq_Id),
      consolidated: row.consolidated, revision: row.type_Sub,
      broadcastDate: row.broadcast_Date || null, creationDate: row.creation_Date || null,
      revisedDate: row.revised_Date || null,
      filed: (broadcast || latest).day,
      filedDateSource: broadcast ? 'broadcast_Date' : 'latest-creation-or-revision',
      // A revision cannot inherit the original's earlier eligibility date.
      availableAfter: latest.day, orderingTime: latest.ms,
      companyName: row.cmName || row.smName || null,
    };
    const prev = selected.get(end);
    if (prev && prev.orderingTime === filing.orderingTime && prev.filingId === filing.filingId
        && JSON.stringify(prev) !== JSON.stringify(filing)) throw new Error('Widerspruechliche Meldungsdubletten');
    if (!prev || filing.orderingTime > prev.orderingTime
        || (filing.orderingTime === prev.orderingTime && BigInt(filing.filingId) > BigInt(prev.filingId))) {
      selected.set(end, filing);
    }
  }
  return [...selected.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

/** Extract revenue from operations from the current three-month context only.
 * @param {string} xml original XBRL document
 * @param {object} filing validated integrated filing entry */
function parseQuarter(xml, filing) {
  if (filing.consolidated !== 'Consolidated') throw new Error('Listen-Riegel: kein Konzernabschluss');
  if (!END.test(filing.periodEnd) || !validDate(filing.periodEnd)) throw new Error('Quartalsende ungueltig');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XBRL mit externer Entitaet abgelehnt');
  const ids = [...xml.matchAll(/<xbrli:context id="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) throw new Error('Doppelte Kontextkennung');
  const p = A.parseXbrl(xml), tk = filing.symbol;
  if (!['in-capmkt', 'in-bse-fin'].includes(p.taxonomie)) throw new Error('Unbekannte XBRL-Taxonomie');
  if (A.faktDokument(p, 'Symbol', tk) !== tk) throw new Error('Datei gehoert zu anderem Symbol');
  if (A.faktDokument(p, 'DescriptionOfPresentationCurrency', tk) !== 'INR') throw new Error('Waehrung ist nicht INR');
  const rounding = A.faktDokument(p, 'LevelOfRounding', tk)
    || A.faktDokument(p, 'LevelOfRoundingUsedInFinancialStatements', tk);
  if (!A.RUNDUNGSSTUFEN.has(rounding)) throw new Error('Unbekannte Rundungsstufe');
  const start = filing.periodEnd.slice(0, 5) + String(Number(filing.periodEnd.slice(5, 7)) - 2).padStart(2, '0') + '-01';
  const contexts = [];
  for (const id of (p.fakten.get('RevenueFromOperations') || new Map()).keys()) {
    const k = p.kontexte.get(id);
    if (!k || k.dims || k.instant) continue;
    const factStart = A.fakt(p, 'DateOfStartOfReportingPeriod', id, tk);
    const factEnd = A.fakt(p, 'DateOfEndOfReportingPeriod', id, tk);
    // Both the dates reported as facts and the context's own dates must prove 3M.
    if (factStart !== start || factEnd !== filing.periodEnd) continue;
    if (k.start !== start || k.ende !== filing.periodEnd) throw new Error('Kontext und gemeldete Periode widersprechen sich');
    if (A.fakt(p, 'NatureOfReportStandaloneConsolidated', id, tk) !== 'Consolidated') {
      throw new Error('Datei-Riegel: kein Konzernabschluss');
    }
    contexts.push(id);
  }
  if (!contexts.length) throw new Error('Kein aktueller Dreimonatsumsatz aus RevenueFromOperations');
  const amounts = [];
  for (const id of contexts) {
    const raw = A.fakt(p, 'RevenueFromOperations', id, tk), value = A.zahl(raw);
    if (value == null || value < 0) throw new Error('Umsatz fehlt oder ist ungueltig');
    const facts = [...xml.matchAll(/<([\w-]+):RevenueFromOperations\s([^>]*?)>([\s\S]*?)<\/\1:RevenueFromOperations>/g)]
      .filter(m => (/\bcontextRef="([^"]+)"/.exec(m[2]) || [])[1] === id);
    if (!facts.length) throw new Error('Umsatzeinheit fehlt');
    for (const m of facts) {
      const attr = m[2], unit = (/\bunitRef="([^"]+)"/.exec(attr) || [])[1];
      if (/\bnil="(?:true|1)"/.test(attr) || /\bscale=/.test(attr)) throw new Error('Nil oder Inline-Skalierung im Roh-XBRL');
      const units = [...xml.matchAll(/<xbrli:unit id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:unit>/g)].filter(x => x[1] === unit);
      if (units.length !== 1 || !/^\s*<xbrli:measure>iso4217:INR<\/xbrli:measure>\s*$/.test(units[0][2])) {
        throw new Error('Umsatzeinheit ist nicht eindeutig INR');
      }
      amounts.push({ value, raw, unit, decimals: (/\bdecimals="([^"]+)"/.exec(attr) || [])[1] || null });
    }
  }
  if (amounts.some(x => x.value !== amounts[0].value)) throw new Error('Widerspruechliche Quartalsumsaetze');
  return {
    periodStart: start, periodEnd: filing.periodEnd, duration: '3M', consolidated: true,
    revenue: amounts[0].value, revenueAsFiled: amounts[0].raw, currency: 'INR',
    unit: amounts[0].unit, multiplier: 1, rounding, decimals: amounts[0].decimals,
    element: 'RevenueFromOperations', taxonomy: p.taxonomie, contexts: contexts.sort(),
    filed: filing.filed, filedDateSource: filing.filedDateSource, broadcastDate: filing.broadcastDate,
    creationDate: filing.creationDate, revisedDate: filing.revisedDate,
    availableAfter: filing.availableAfter, availabilityRule: 'next-NSE-trading-day-after-availableAfter',
    filingId: filing.filingId, revision: filing.revision, url: filing.url,
    contentSha256: crypto.createHash('sha256').update(xml).digest('hex'),
  };
}

/** Build conservative listing aliases from unique, identical full watchlist names.
 * No suffix replacement or shortened-name matching is used.
 * @param {Array} stocks watchlist records */
function listingMap(stocks) {
  const names = new Map(), aliases = {}, evidence = {}, unresolved = [];
  const indian = stocks.filter(s => /\.(NS|BO)$/.test(s.ticker));
  const name = s => String(s.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  for (const s of indian) {
    if (!name(s)) continue;
    if (!names.has(name(s))) names.set(name(s), []);
    names.get(name(s)).push(s);
  }
  for (const s of indian.filter(x => x.ticker.endsWith('.NS'))) {
    if (!SYMBOL.test(s.ticker.slice(0, -3))) throw new Error('Ungueltiger NSE-Ticker');
    aliases[s.ticker] = s.ticker;
  }
  for (const s of indian.filter(x => x.ticker.endsWith('.BO'))) {
    const group = names.get(name(s)) || [], ns = group.filter(x => x.ticker.endsWith('.NS'));
    if (ns.length === 1 && group.filter(x => x.ticker.endsWith('.BO')).length === 1) {
      aliases[s.ticker] = ns[0].ticker;
      evidence[s.ticker] = { canonical: ns[0].ticker, basis: 'unique-exact-full-watchlist-name', name: s.name };
    } else unresolved.push(s.ticker);
  }
  return { aliases, evidence, unresolved };
}

/** Create an empty shadow-only store.
 * @param {object} mapping listingMap result */
function emptyStore(mapping = { aliases: {}, evidence: {} }) {
  return { version: 1, market: 'IN', mode: 'shadow', aliases: { ...mapping.aliases },
    aliasEvidence: { ...mapping.evidence }, sources: {}, companies: {} };
}

/** Append a validated quarter, preserving all observations and confirmations.
 * @param {object} store mutable store
 * @param {string} ticker canonical .NS ticker
 * @param {object} observation parseQuarter result
 * @param {object} confirmation source id and observed time */
function appendQuarter(store, ticker, observation, confirmation) {
  if (!ticker.endsWith('.NS') || store.aliases[ticker] !== ticker) throw new Error('Kanonischer NSE-Ticker fehlt');
  const company = store.companies[ticker] ||= { quarterly: {} };
  return S.mergeObservation(company.quarterly[observation.periodEnd] ||= [], observation, confirmation);
}

/** Extend aliases without reassigning previously recorded identities.
 * @param {object} store mutable store
 * @param {object} mapping listingMap result */
function extendAliases(store, mapping) {
  for (const [alias, canonical] of Object.entries(mapping.aliases)) {
    if (store.aliases[alias] && store.aliases[alias] !== canonical) throw new Error('Alias-Zuordnung hat sich geaendert: ' + alias);
    store.aliases[alias] = canonical;
    if (mapping.evidence[alias] && !store.aliasEvidence[alias]) store.aliasEvidence[alias] = mapping.evidence[alias];
  }
}

/** Check the shared append-only contract plus the India listing metadata.
 * @param {object|null} before old store
 * @param {object} after proposed store */
function assertStore(before, after) {
  if (after.version !== 1 || after.market !== 'IN' || after.mode !== 'shadow'
      || !after.aliases || !after.aliasEvidence || !after.sources || !after.companies) throw new Error('Ungueltiger NSE-Speicher');
  S.assertAppendOnly(before, after);
  for (const field of ['aliases', 'aliasEvidence']) for (const [k, v] of Object.entries(before?.[field] || {})) {
    if (JSON.stringify(after[field][k]) !== JSON.stringify(v)) throw new Error('NSE-Speicher aendert ' + field + ': ' + k);
  }
}

module.exports = { FINANCIALS, BASIS, ARCHIVE, validDate, timestamp, archiveUrl, selectFilings,
  parseQuarter, listingMap, emptyStore, appendQuarter, extendAliases, assertStore };
