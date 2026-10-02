'use strict';
/**
 * lib/value-open-items.js — sticky open-items list for stored values that jump by more than
 * factor 3 (Tag 1398, value-gate rebuild PR2). Pure logic; scripts/value-open-items.js does the IO.
 *
 * Key = (ticker, field, periodEnd) for revenueQ / grossProfitQ (period from *QEnds), and
 * (ticker, marketCap, null). Comparison value b for a key, in this order:
 *   1. the cell's acceptedValue inside an OPEN item (sticky, written once, never changed);
 *   2. otherwise the most recent finite value > 0 of the key in ANY earlier stored, not globally
 *      excluded, not structurally flagged board file (the caller builds that index, see indexVintage);
 *      but when the key's last item was closed on or after that day, the value it had at the close
 *      (`closedValue`, finite, 0 included): a close accepts the value it saw. Without this a quarantined
 *      series stuck at 0 (OLPX gross profit) reopened a new item every day against its old value;
 *   3. none: not a hit (a fill).
 * Hit: b > 0 and today's v finite and (v === 0, or v > 0 with max(v/b, b/v) > 3 strictly).
 * Not a hit: v null (coverage is checked elsewhere), v negative (sign change), key never seen.
 *
 * One item per (ticker, field); a new jumping period of the same ticker/field joins the open item
 * as a new cell. An item closes ONLY when every cell is covered by
 *   (a) a hand-table row: financial-known-cases case for ticker or listing alias + field + period;
 *       a ticker-level quarantine covers all cells; an ADS or share-count table row for the ticker
 *       covers a marketCap cell; or
 *   (b) an acceptance entry (data-health/value-acceptances.json, written only by the AI daily run);
 *       it covers only cells whose firstSeen <= its acceptedAt.
 * Never by time, never by a label, never by returning to the old value (label 'zurueckgekehrt').
 * Labels describe, they never close.
 *
 * Append-only: items are never removed; id, company, field, firstSeen, acceptedValue and every
 * existing cell's periodEnd / acceptedValue / firstSeen never change; a closed item never reopens
 * (a new item opens instead). assertAppendOnly() throws on any violation, before anything is written.
 */

const fs = require('fs');

const SCHEMA = 'value-open-items/v1';
const FACTOR = 3;
const SHARE_TOL = 0.05;   // kapitalmassnahme: share count moved by the same factor, +-5 %
const SERIES = [['revenueQ', 'revenueQEnds'], ['grossProfitQ', 'grossProfitQEnds']];
const LABEL_ORDER = ['korrigiert-von-uns', 'kapitalmassnahme', 'zurueckgekehrt', 'nicht-auf-board'];

const DOC = 'Sticky open-items list (Tag 1398). Written only by scripts/value-open-items.js in the daily run '
  + '(step "Value open-items (factor 3, sticky)"). An item opens when a stored revenueQ/grossProfitQ (same '
  + 'quarter) or marketCap moves by more than factor 3 (or to 0) against its last accepted value, and stays '
  + 'open until a hand-table row or an entry in data-health/value-acceptances.json closes it. Labels only '
  + 'describe. Never edit by hand; the AI daily run works the list (docs/value-open-items.md).';

const finitePos = (x) => Number.isFinite(x) && x > 0;
const round4 = (f) => (Number.isFinite(f) ? Math.round(f * 1e4) / 1e4 : null);
const sharesOf = (pit) => (pit && finitePos(pit.sharesOutstanding) ? pit.sharesOutstanding : null);
// YYYY-MM-DD that is a real calendar day (2026-02-30 and 2026-13-45 have the shape but are not).
const isRealDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/**
 * Factor of a hit, or null when (b, v) is not a hit. v === 0 gives Infinity.
 * @param {number} b comparison value
 * @param {number} v today's value
 * @returns {number|null}
 */
function jump(b, v) {
  if (!finitePos(b) || !Number.isFinite(v) || v < 0) return null;
  if (v === 0) return Infinity;
  const f = Math.max(v / b, b / v);
  return f > FACTOR ? f : null;
}

/**
 * Cells of one pit block: Map `${field}|${periodEnd}` -> value ('' for marketCap's period).
 * A repeated period end inside one series keeps its first value.
 * @param {object|null} pit
 * @returns {Map<string, *>}
 */
function pitCells(pit) {
  const out = new Map();
  if (!pit || typeof pit !== 'object') return out;
  for (const [f, e] of SERIES) {
    const vs = Array.isArray(pit[f]) ? pit[f] : [];
    const es = Array.isArray(pit[e]) ? pit[e] : [];
    vs.forEach((v, i) => {
      const p = es[i];
      if (typeof p === 'string' && p && !out.has(f + '|' + p)) out.set(f + '|' + p, v);
    });
  }
  out.set('marketCap|', pit.marketCap);
  return out;
}

/**
 * Rows of the stored/built board files of one day: Map ticker -> { board, pit }. First board wins
 * (tickers are unique across boards; a duplicate carries the same snapshot anyway).
 * @param {object[]} boardFiles parsed board vintages (objects with .cohort)
 * @returns {Map<string, {board: string, pit: object|null}>}
 */
function dayRows(boardFiles) {
  const out = new Map();
  for (const v of boardFiles) {
    if (!v || !v.cohort) continue;
    for (const t of ['profitable', 'unprofitable']) {
      for (const r of (Array.isArray(v.cohort[t]) ? v.cohort[t] : [])) {
        if (r && typeof r.ticker === 'string' && !out.has(r.ticker)) out.set(r.ticker, { board: v.board, pit: r.pit || null });
      }
    }
  }
  return out;
}

/**
 * Adds one stored day to the last-seen index (call oldest -> newest; newer wins).
 * The caller passes only board files that may serve as comparison source (not structural).
 * @param {Map<string, object>} index key `${ticker}|${field}|${periodEnd}` -> { value, date, shares }
 * @param {Map<string, object>} rows dayRows() of that day
 * @param {string} date the day
 */
function indexVintage(index, rows, date) {
  for (const [ticker, { pit }] of rows) {
    const shares = sharesOf(pit);
    for (const [ck, v] of pitCells(pit)) {
      if (finitePos(v)) index.set(ticker + '|' + ck, { value: v, date, shares: ck === 'marketCap|' ? shares : null });
    }
  }
}

/** Empty state. */
function emptyState() {
  return { _doc: DOC, schema: SCHEMA, factor: FACTOR, updatedFor: null, items: [] };
}

/**
 * Throws unless a parsed state file has the expected shape.
 * @param {object} s
 * @returns {object} s
 */
function validateState(s) {
  if (!s || typeof s !== 'object' || s.schema !== SCHEMA || !Array.isArray(s.items)) {
    throw new Error('value-open-items: state is not ' + SCHEMA + ' with an items array');
  }
  for (const it of s.items) {
    if (!it || typeof it.id !== 'string' || !Array.isArray(it.cells) || !['open', 'closed'].includes(it.status)) {
      throw new Error('value-open-items: malformed item ' + JSON.stringify(it && it.id));
    }
  }
  return s;
}

/**
 * Normalises the hand tables into what closing and labels need.
 * @param {object} raw { fkc, ads, shares, statementCurrency, q4 } parsed files (each may be null)
 * @returns {{cases: object[], quarantines: object[], mcapRows: Map<string,string>, korrigiert: Set<string>}}
 */
function buildTables(raw) {
  const r = raw || {};
  const fkc = r.fkc || { cases: [], coverage: [], quarantines: [] };
  const listings = (x) => [x.ticker, ...(Array.isArray(x.listingAliases) ? x.listingAliases : [])];
  const rowKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).filter((k) => !k.startsWith('_')) : []);
  const korrigiert = new Set();
  const cases = [];
  for (const c of fkc.cases || []) {
    for (const t of listings(c)) korrigiert.add(t);
    if (c.field === 'revenueQ' || c.field === 'grossProfitQ') cases.push({ caseId: c.caseId, field: c.field, period: c.period, listings: listings(c) });
  }
  for (const v of fkc.coverage || []) for (const t of listings(v)) korrigiert.add(t);
  const quarantines = (fkc.quarantines || []).map((q) => ({ caseId: q.caseId, listings: listings(q) }));
  for (const q of quarantines) for (const t of q.listings) korrigiert.add(t);
  // Key by ticker only: the ADS table and PR #406's share-count table differ in their fields.
  const mcapRows = new Map();
  for (const t of rowKeys(r.ads)) mcapRows.set(t, 'hand-table:ads:' + t);
  for (const t of rowKeys(r.shares)) if (!mcapRows.has(t)) mcapRows.set(t, 'hand-table:shares:' + t);
  for (const t of mcapRows.keys()) korrigiert.add(t);
  for (const t of rowKeys(r.statementCurrency)) korrigiert.add(t);
  for (const c of (r.q4 && r.q4.cases) || []) for (const t of (Array.isArray(c.listingAliases) ? c.listingAliases : [])) korrigiert.add(t);
  return { cases, quarantines, mcapRows, korrigiert };
}

/**
 * Validates acceptance entries; malformed ones are reported and ignored (never a crash).
 * @param {object|null} raw parsed data-health/value-acceptances.json
 * @returns {{entries: object[], warnings: string[]}} entries carry their 1-based position `n`
 */
function readAcceptances(raw) {
  const warnings = [];
  const list = raw && Array.isArray(raw.acceptances) ? raw.acceptances : [];
  if (raw && !Array.isArray(raw.acceptances)) warnings.push('value-acceptances: no "acceptances" array, nothing applied');
  const entries = [];
  list.forEach((a, i) => {
    const n = i + 1;
    const bad = !a || typeof a.itemId !== 'string' || !finitePos(a.value) || typeof a.reason !== 'string' || !a.reason.trim()
      || !isRealDay(a.acceptedAt)
      || (a.periodEnd !== undefined && a.periodEnd !== null && typeof a.periodEnd !== 'string');
    if (bad) { warnings.push('value-acceptances entry ' + n + ' ignored: needs itemId, value > 0, acceptedAt (YYYY-MM-DD) and a reason'); return; }
    entries.push({ ...a, n });
  });
  return { entries, warnings };
}

function headlineOf(cells) {
  let best = cells[0];
  for (const c of cells) {
    const fc = c.factor == null ? Infinity : c.factor;
    const fb = best.factor == null ? Infinity : best.factor;
    if (fc > fb) best = c;
  }
  return best;
}

/**
 * One run of the step for date D.
 * @param {object} args
 * @param {string} args.date run date D
 * @param {Map<string, object>} args.today dayRows() of today's values
 * @param {Map<string, object>} args.index last-seen index over stored days < D (indexVintage)
 * @param {object} args.prior previous state (validated) or emptyState()
 * @param {object[]} args.acceptances readAcceptances().entries
 * @param {object} args.tables buildTables()
 * @returns {{state: object, summary: object, warnings: string[], notes: string[]}}
 */
function updateOpenItems({ date, today, index, prior, acceptances, tables }) {
  const state = JSON.parse(JSON.stringify(prior || emptyState()));
  state._doc = DOC; state.schema = SCHEMA; state.factor = FACTOR; state.updatedFor = date;
  const items = state.items;
  const warnings = [];
  const notes = [];
  const ids = new Set(items.map((it) => it.id));
  const newId = (base) => { let id = base; for (let k = 2; ids.has(id); k++) id = base + '#' + k; ids.add(id); return id; };
  const openBy = new Map();
  for (const it of items) if (it.status === 'open') openBy.set(it.company + '|' + it.field, it);
  const created = [];
  // Value accepted at the last close of a key (see header, rule 2).
  const lastClose = new Map();
  for (const it of items) {
    if (it.status !== 'closed') continue;
    for (const c of it.cells) {
      if (!Number.isFinite(c.closedValue)) continue;
      const k = it.company + '|' + it.field + '|' + (c.periodEnd || '');
      const prev = lastClose.get(k);
      if (!prev || it.closedAt >= prev.date) lastClose.set(k, { value: c.closedValue, date: it.closedAt, shares: null });
    }
  }

  const makeItem = (ticker, board, field, cells, idBase) => {
    const h = headlineOf(cells);
    const it = {
      id: newId(idBase || ticker + '|' + field + '|' + date), company: ticker, board, field,
      periodEnd: h.periodEnd, acceptedValue: h.acceptedValue, newValue: h.newValue, factor: h.factor,
      firstSeen: date, lastSeen: date, cells, labels: [], status: 'open', closedBy: null, closedAt: null,
    };
    items.push(it); openBy.set(ticker + '|' + field, it); created.push(it);
    return it;
  };

  // 1) compare today's cells
  const fresh = new Map();   // ticker|field -> { board, cells[] }
  for (const [ticker, { board, pit }] of today) {
    const shares = sharesOf(pit);
    for (const [ck, v] of pitCells(pit)) {
      const [field, pe] = ck.split('|');
      const periodEnd = pe || null;
      const open = openBy.get(ticker + '|' + field);
      const cell = open && open.cells.find((c) => c.periodEnd === periodEnd);
      if (cell) {   // sticky: compare against the value accepted when the item opened
        const f = jump(cell.acceptedValue, v);
        if (f != null) {
          cell.newValue = v; cell.factor = round4(f); cell.lastSeen = date;
          if (field === 'marketCap') cell.newShares = shares;
          open.lastSeen = date; open.board = board;
        }
        continue;
      }
      let base = index.get(ticker + '|' + ck);
      const cl = lastClose.get(ticker + '|' + ck);
      if (cl && (!base || cl.date >= base.date)) base = cl;
      const f = base ? jump(base.value, v) : null;
      if (f == null) continue;
      // A same-day rerun after a same-day close records nothing twice.
      const again = items.find((it) => it.id === ticker + '|' + field + '|' + date && it.cells.some((c) => c.periodEnd === periodEnd));
      if (again) continue;
      const c = { periodEnd, acceptedValue: base.value, acceptedFrom: base.date, newValue: v, factor: round4(f), firstSeen: date, lastSeen: date };
      if (field === 'marketCap') { c.acceptedShares = base.shares; c.newShares = shares; }
      const k = ticker + '|' + field;
      if (!fresh.has(k)) fresh.set(k, { board, cells: [] });
      fresh.get(k).cells.push(c);
    }
  }
  for (const [k, { board, cells }] of fresh) {
    const [ticker, field] = k.split('|');
    const open = openBy.get(k);
    if (open) { open.cells.push(...cells); open.lastSeen = date; open.board = board; } else makeItem(ticker, board, field, cells);
  }
  // Headline fields follow the headline cell chosen at open (its acceptedValue never changes).
  for (const it of items) {
    if (it.status !== 'open') continue;
    const h = it.cells.find((c) => c.periodEnd === it.periodEnd) || it.cells[0];
    it.newValue = h.newValue; it.factor = h.factor;
  }

  // 2) labels (describe only; recomputed for open items, frozen once an item closes)
  let sharesUnknown = 0;
  for (const it of items) {
    if (it.status !== 'open') continue;
    const labels = new Set();
    if (tables.korrigiert.has(it.company)) labels.add('korrigiert-von-uns');
    if (it.field === 'marketCap') {
      for (const c of it.cells) {
        if (!finitePos(c.acceptedShares) || !finitePos(c.newShares)) { sharesUnknown++; continue; }
        if (!finitePos(c.newValue)) continue;
        const r = c.newValue / c.acceptedValue;
        const s = c.newShares / c.acceptedShares;
        if (Math.abs(s / r - 1) <= SHARE_TOL) labels.add('kapitalmassnahme');
      }
    }
    const row = today.get(it.company);
    if (!row) labels.add('nicht-auf-board');
    else {
      const cells = pitCells(row.pit);
      const back = it.cells.every((c) => {
        const v = cells.get(it.field + '|' + (c.periodEnd || ''));
        return finitePos(v) && jump(c.acceptedValue, v) == null;
      });
      if (back) labels.add('zurueckgekehrt');
    }
    it.labels = LABEL_ORDER.filter((l) => labels.has(l));
  }
  if (sharesUnknown) notes.push('kapitalmassnahme not computable for ' + sharesUnknown + ' marketCap cell(s): no share count stored for the accepted or the new value (pit.sharesOutstanding exists from Tag 1398 on)');

  // 3) closing: every cell covered by a hand-table row or an acceptance entry
  const byItem = new Map();
  for (const a of acceptances || []) {
    if (!ids.has(a.itemId)) { warnings.push('value-acceptances entry ' + a.n + ': unknown itemId ' + a.itemId + ' (ignored)'); continue; }
    if (!byItem.has(a.itemId)) byItem.set(a.itemId, []);
    byItem.get(a.itemId).push(a);
  }
  let closed = 0, reopened = 0;
  for (const it of items.slice()) {
    if (it.status !== 'open') continue;
    const quarantine = tables.quarantines.find((q) => q.listings.includes(it.company));
    const accs = byItem.get(it.id) || [];
    for (const a of accs) {
      if (a.periodEnd != null && !it.cells.some((c) => c.periodEnd === a.periodEnd)) warnings.push('value-acceptances entry ' + a.n + ': item ' + it.id + ' has no cell ' + a.periodEnd + ' (ignored)');
    }
    const cover = it.cells.map((c) => {
      if (quarantine) return { src: 'hand-table:quarantine:' + quarantine.caseId };
      if (it.field === 'marketCap') { const m = tables.mcapRows.get(it.company); if (m) return { src: m }; }
      const kase = tables.cases.find((k) => k.field === it.field && k.period === c.periodEnd && k.listings.includes(it.company));
      if (kase) return { src: 'hand-table:' + kase.caseId };
      // Only cells the item had when the acceptance was written: a later joining cell was never reviewed.
      const a = accs.find((x) => (x.periodEnd == null || x.periodEnd === c.periodEnd) && c.firstSeen <= x.acceptedAt);
      if (a) return { src: 'acceptance:' + a.n, acceptance: a };
      return null;
    });
    if (!cover.every(Boolean)) continue;
    it.status = 'closed';
    it.closedBy = [...new Set(cover.map((x) => x.src))].join(' + ');
    it.closedAt = date;
    openBy.delete(it.company + '|' + it.field);
    closed++;
    const row = today.get(it.company);
    const cells = row ? pitCells(row.pit) : new Map();
    it.cells.forEach((c, i) => {
      const v = cells.get(it.field + '|' + (c.periodEnd || ''));
      // No value today (company off the board): an acceptance still fixes what is right, so the
      // rejected value is compared again on return. A hand-table close records nothing then.
      const a = cover[i].acceptance;
      c.closedValue = Number.isFinite(v) ? v : (a ? a.value : null);
    });
    // An accepted value that today's value is again more than factor 3 away from opens a new item.
    const again = [];
    it.cells.forEach((c, i) => {
      const a = cover[i].acceptance;
      if (!a) return;
      const v = cells.get(it.field + '|' + (c.periodEnd || ''));
      const f = jump(a.value, v);
      if (f == null) return;
      const nc = { periodEnd: c.periodEnd, acceptedValue: a.value, acceptedFrom: 'acceptance:' + a.n, newValue: v, factor: round4(f), firstSeen: date, lastSeen: date };
      if (it.field === 'marketCap') { nc.acceptedShares = null; nc.newShares = sharesOf(row && row.pit); }
      again.push(nc);
    });
    if (again.length) { const n = makeItem(it.company, row ? row.board : it.board, it.field, again); n.labels = it.labels.slice(); reopened++; }
  }

  const open = items.filter((it) => it.status === 'open').length;
  return { state, summary: { date, open, new: created.length, closed, reopened, total: items.length }, warnings, notes };
}

/**
 * Throws when `next` breaks the append-only contract against `prior`.
 * @param {object} prior
 * @param {object} next
 */
function assertAppendOnly(prior, next) {
  const fail = (m) => { throw new Error('value-open-items append-only violation: ' + m); };
  const byId = new Map();
  for (const it of next.items) { if (byId.has(it.id)) fail('duplicate item ' + it.id); byId.set(it.id, it); }
  for (const p of (prior && prior.items) || []) {
    const n = byId.get(p.id);
    if (!n) fail('item removed: ' + p.id);
    for (const k of ['id', 'company', 'field', 'firstSeen', 'acceptedValue']) if (!Object.is(n[k], p[k])) fail(p.id + ' changed ' + k);
    if (p.status === 'closed' && n.status !== 'closed') fail(p.id + ' reopened');
    for (const pc of p.cells) {
      const nc = n.cells.find((c) => c.periodEnd === pc.periodEnd);
      if (!nc) fail(p.id + ' cell removed: ' + pc.periodEnd);
      for (const k of ['periodEnd', 'acceptedValue', 'firstSeen']) if (!Object.is(nc[k], pc[k])) fail(p.id + ' cell ' + pc.periodEnd + ' changed ' + k);
    }
  }
}

/**
 * Row flags for the findash export and the stored vintage row (Tag 1401, value-gate PR3): one
 * entry per cell of every OPEN item, keyed by the item's company (ticker). Closed items give
 * nothing. The flag only marks a row; no value changes (owner decision 01.10.2026).
 * @param {object} state a validated list state
 * @returns {Map<string, object[]>} ticker -> [{field, periodEnd, acceptedValue, newValue, factor, firstSeen, labels}]
 */
function valueFlagsByTicker(state) {
  const out = new Map();
  for (const it of state.items) {
    if (it.status !== 'open') continue;
    for (const c of it.cells) {
      if (!out.has(it.company)) out.set(it.company, []);
      out.get(it.company).push({
        field: it.field, periodEnd: c.periodEnd == null ? null : c.periodEnd, acceptedValue: c.acceptedValue,
        newValue: c.newValue, factor: c.factor == null ? null : c.factor, firstSeen: c.firstSeen,
        labels: Array.isArray(it.labels) ? it.labels.slice() : [],
      });
    }
  }
  return out;
}

/**
 * Reads the list file for the two writers. Never throws: a missing, unreadable or malformed
 * file gives no flags and one ::warning:: line (the export and the vintage must never fail on it).
 * @param {string} file path of data-health/value-open-items.json
 * @param {function} [warn] logger
 * @returns {Map<string, object[]>}
 */
function readValueFlags(file, warn = console.warn) {
  try {
    return valueFlagsByTicker(validateState(JSON.parse(fs.readFileSync(file, 'utf8'))));
  } catch (e) {
    warn('::warning::value flags: ' + file + ' (data-health/value-open-items.json) not usable, no row is marked: ' + (e && e.message));
    return new Map();
  }
}

module.exports = {
  SCHEMA, FACTOR, LABEL_ORDER, jump, pitCells, dayRows, indexVintage, emptyState, validateState,
  buildTables, readAcceptances, updateOpenItems, assertAppendOnly, valueFlagsByTicker, readValueFlags,
};
