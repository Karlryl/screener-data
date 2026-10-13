'use strict';
// Offline report: no scoring replay, downloads, dependencies or repository writes.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { gzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const { isDeepStrictEqual: equal } = require('node:util');
const { parseArgs } = require('node:util');

const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = xs => [...xs].sort(cmp);
const value = x => x && typeof x === 'object' && Object.hasOwn(x, 'value') ? x.value : x;
const present = x => x === undefined ? { absent: true } : x;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const parse = x => JSON.parse(String(x).replace(/^\uFEFF/, ''));
const read = p => parse(fs.readFileSync(p));
const volatile = new Set(['asOf', 'fetchedAt', 'computedAt', '_pullModeAt', 'lastCheckedAt']);
const marketFields = /^(marketCap|price|meta\.(tradingFxRateApplied|fxRateSourceTrading|tradingCurrencyOriginal|priceCurrency|sharesOutstanding|impliedSharesOutstanding|floatShares)|metrics\.(priceSales|forwardPE|pe|fiftyTwoWeekHigh|enterpriseValue|enterpriseToEbitda|enterpriseToRevenue|beta|targetMeanPrice|targetMedianPrice|dividendYield|payoutRatio))$/;
const germanBoards = { 'consumer-discretionary': 'Zyklischer Konsum', 'consumer-staples': 'Basiskonsum', energy: 'Energie', financials: 'Finanzen', 'health-care': 'Gesundheit', industrials: 'Industrie', 'it-services': 'IT-Dienste', materials: 'Rohstoffe', 'real-estate': 'Immobilien', semiconductors: 'Halbleiter', 'software-comm-services': 'Software und Kommunikation', survival: 'Überleben', 'tech-hardware': 'Technische Hardware', utilities: 'Versorger' };

function clean(x) {
  if (Array.isArray(x)) return x.map(clean);
  if (x && typeof x === 'object') return Object.fromEntries(sorted(Object.keys(x)).filter(k => !volatile.has(k)).map(k => [k, clean(x[k])]));
  return x;
}
/**
 * Compare stable snapshot fields, preserving absent, null and zero values.
 * @param {object} a Earlier snapshot.
 * @param {object} b Later snapshot.
 */
function differences(a, b) {
  const out = [];
  function add(field, x, y) { if (!equal(x, y)) out.push({ field, old: present(x), new: present(y) }); }
  for (const group of ['timeseries', 'annual', 'metrics', 'meta']) {
    for (const k of sorted(new Set([...Object.keys(a[group] || {}), ...Object.keys(b[group] || {})]))) {
      if (group !== 'meta' || !volatile.has(k)) add(group + '.' + k, clean(a[group]?.[k]), clean(b[group]?.[k]));
    }
  }
  for (const k of ['marketCap', 'price', 'external', 'insiderActivity', '_ftsPartial']) add(k, clean(a[k]), clean(b[k]));
  return out;
}
/**
 * Return the latest usable revenue quarter, or null.
 * @param {object|null} s Snapshot.
 */
function newest(s) {
  return sorted((s?.timeseries?.revenueQEnds || []).filter((d, i) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d && Number.isFinite(value(s.timeseries.revenueQ?.[i])))).at(-1) || null;
}
/**
 * Classify observed input changes without claiming score causality.
 * @param {object|null} a Earlier snapshot.
 * @param {object|null} b Later snapshot.
 * @param {object[]} deltas Changed fields.
 * @param {object[]} overlays Confirmed hand-table effects.
 */
function classify(a, b, deltas, overlays = []) {
  if (overlays.length) return overlays.some(e => e.replacementValue !== null) ? 'HANDTABELLE' : 'RÜCKHALT';
  if (!b) return 'SNAPSHOT FEHLT';
  if (!a) return 'NACHLADEN';
  if (newest(a) && newest(b) && newest(b) > newest(a)) return 'NEUES QUARTAL';
  if (deltas.some(e => !marketFields.test(e.field)) || a.meta?.fetchedAt !== b.meta?.fetchedAt) return 'NACHLADEN';
  return deltas.length ? 'NUR KURS' : 'UNVERÄNDERTE EINGABE';
}
function cell(source, field, period) {
  const ends = source?.[field + 'Ends'];
  const index = Array.isArray(ends) ? ends.indexOf(period) : -1;
  return index < 0 ? undefined : value(source[field]?.[index]);
}
function near(a, b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-9); }
/**
 * Confirm quarterly corrections against raw snapshots and dated board PIT.
 * @param {string} ticker Listing identity.
 * @param {object|null} a Earlier snapshot.
 * @param {object|null} b Later snapshot.
 * @param {object|null} old Earlier board row.
 * @param {object|null} fresh Later board row.
 * @param {object[]} cases Current hand-table cases.
 */
function tableEvidence(ticker, a, b, old, fresh, cases) {
  const candidates = cases.filter(c => (c.ticker === ticker || c.listingAliases?.includes(ticker)) && !equal(c.expectedBadValue, c.replacementValue));
  const confirmed = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.expectedBadValue) || (c.replacementValue !== null && !Number.isFinite(c.replacementValue))) continue;
    // Current configuration alone cannot establish when a read-time correction became active.
    const before = cell(old?.pit, c.field, c.period), after = cell(fresh?.pit, c.field, c.period);
    const fx0 = old?.pit?.fxRateApplied, fx1 = fresh?.pit?.fxRateApplied;
    if (!old || !fresh || old.pit?.reportingCurrencyOriginal !== c.currency || fresh.pit?.reportingCurrencyOriginal !== c.currency || !Number.isFinite(fx0) || !Number.isFinite(fx1) || !(fx0 > 0) || !(fx1 > 0)) continue;
    const raw0 = cell(a?.timeseries, c.field, c.period), raw1 = cell(b?.timeseries, c.field, c.period);
    if (!near(before, c.expectedBadValue * fx0) || !near(raw0, before) || !near(raw1, c.expectedBadValue * fx1)) continue;
    if (c.replacementValue === null ? after !== null : !near(after, c.replacementValue * fx1)) continue;
    confirmed.push({ ...c, observedBeforeUSD: before, observedAfterUSD: after, fxBefore: fx0, fxAfter: fx1 });
  }
  return { confirmed, candidates };
}
/**
 * Index explicit daily exclusions; retained earlier size exits are not new exits.
 * @param {object|null} doc Dated exclusion export.
 * @param {object|null} manifest Validated size-exits/v2 artifact, authoritative when present.
 * @returns {Map} Exclusions indexed by listing identity.
 */
function exclusions(doc, manifest = null) {
  const map = new Map();
  if (manifest) doc = { ...doc, rows: doc ? doc.rows : [], generated_at: manifest.runDate, sizeExitsKnown: manifest.known, sizeExits: manifest.exits };
  if (!doc) return map;
  assert(Array.isArray(doc.rows), 'excluded.json must contain rows');
  for (const group of doc.rows) for (const leg of group.beine || [group]) {
    assert(typeof leg.ticker === 'string' && typeof leg.reason === 'string' && leg.reason.length, 'Invalid excluded ticker/reason');
    if (!map.has(leg.ticker)) map.set(leg.ticker, []);
    map.get(leg.ticker).push({ ...leg, imBoardAls: group.imBoardAls ?? leg.imBoardAls ?? null, issuerKey: group.issuerKey ?? leg.issuerKey ?? null });
  }
  if (doc.sizeExits !== undefined) {
    assert(Array.isArray(doc.sizeExits), 'Invalid sizeExits');
    for (const r of doc.sizeExits) {
      assert(typeof r.ticker === 'string' && r.ticker.length && Number.isFinite(r.marketCapUsd) && r.marketCapUsd >= 0 && Number.isFinite(r.floorUsd) && r.marketCapUsd < r.floorUsd && ['price-only', 'full-pull'].includes(r.source) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(Date.parse(r.date)) && new Date(r.date).toISOString().slice(0, 10) === r.date && (r.date === (doc.generated_at?.slice(0, 10) || doc.date) || (typeof doc.sizeExitsKnown === 'boolean' && r.date < (doc.generated_at?.slice(0, 10) || doc.date))), 'Invalid/stale size exit');
      // P155 retains earlier exits; they cannot explain a new daily disappearance.
      if (doc.sizeExitsKnown === false || r.date !== (doc.generated_at?.slice(0, 10) || doc.date)) continue;
      if (!map.has(r.ticker)) map.set(r.ticker, []);
      map.get(r.ticker).push({ ...r, reason: 'market-cap-floor' });
    }
  }
  return map;
}
/**
 * Explain a global entry or exit using the opposite daily universe.
 * @param {string} ticker Listing identity.
 * @param {string} direction entry or exit.
 * @param {Map[]} universes Earlier and later board universes.
 * @param {Map[]} exMaps Earlier and later exclusion indexes.
 * @param {object} detail Snapshot presence evidence.
 * @param {Array<boolean|null>} sizeKnown Earlier and later size-exit coverage.
 * @returns {object} Membership reason and its evidence confidence.
 */
function membership(ticker, direction, universes, exMaps, detail, sizeKnown = [null, null]) {
  const from = direction === 'exit' ? 0 : 1, to = 1 - from;
  const ex = exMaps[to].get(ticker) || [];
  const replacement = ex.find(e => e.reason === 'dup-issuer' && typeof e.imBoardAls === 'string' && e.imBoardAls !== ticker && universes[to].has(e.imBoardAls));
  if (replacement) return { reasonClass: 'LISTINGWECHSEL', replacementTicker: replacement.imBoardAls, silent: false, confidencePct: 99, reason: `Andere Notierung derselben Firma: ${replacement.imBoardAls}; in der Ausschlussliste belegt.`, exclusions: ex };
  const floor = ex.find(e => e.reason === 'market-cap-floor');
  if (floor) return { reasonClass: 'BÖRSENWERTGRENZE', silent: false, confidencePct: 100, reason: 'Die datierte Ausschlussliste nennt die Größenuntergrenze.', exclusions: ex };
  if (ex.length) return { reasonClass: 'AUSSCHLUSS', silent: false, confidencePct: 100, reason: `Die ${direction === 'exit' ? 'neue' : 'bisherige'} Ausschlussliste nennt ${sorted(new Set(ex.map(e => e.reason))).join(', ')}.`, exclusions: ex };
  if (direction === 'entry' && !detail.presentBefore && detail.presentAfter) return { reasonClass: 'NACHLADEN', silent: false, confidencePct: 95, reason: 'Der Firmensnapshot ist erstmals im neueren Eingang vorhanden.', exclusions: [] };
  if (direction === 'entry' && detail.presentBefore && detail.presentAfter && typeof detail.fetchedAt?.[0] === 'string' && Number.isFinite(Date.parse(detail.fetchedAt[0])) && detail.fetchedAt[0].slice(0, 10) === detail.snapshotDates?.[0]) return { reasonClass: 'NACHLADEN', silent: false, confidencePct: 95, reason: 'Der Firmensnapshot wurde am vorherigen Vergleichstag abgerufen und erscheint jetzt erstmals in den verglichenen Ranglisten; der genaue Zeitpunkt der Aufnahme ist damit nicht belegt.', exclusions: [] };
  return { reasonClass: 'UNGEKLÄRT', silent: true, confidencePct: 40, reason: sizeKnown[to] === false ? 'Größenabgänge sind unbekannt, weil kein vollständiger Bericht dieses Laufs vorliegt; frühere Größenabgänge belegen den heutigen Aufnahme- oder Ausschlussgrund nicht.' : 'Der konkrete Aufnahme- oder Ausschlussgrund ist in den erlaubten Eingaben nicht belegt.', exclusions: [] };
}
function dateOf(folder) {
  const parent = path.basename(path.dirname(path.resolve(folder))).replaceAll('-', '');
  assert(/^\d{8}$/.test(parent) && path.basename(folder) === 'snapshots', 'Use a dated YYYYMMDD/snapshots directory');
  const d = `${parent.slice(0, 4)}-${parent.slice(4, 6)}-${parent.slice(6)}`;
  assert(!Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'Invalid date');
  return d;
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function sourceFile(file, root) {
  assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() && inside(fs.realpathSync(root), fs.realpathSync(file)), `Source must be a regular file within its input directory: ${file}`);
  return fs.readFileSync(file);
}
/**
 * Load and validate local inputs, pinning origin/main once in repository mode.
 * @param {object} options CLI options; paths are read-only.
 */
function load(options) {
  const folders = [options.before, options.after].map(p => fs.realpathSync(p));
  const dates = folders.map(dateOf);
  assert(dates[0] < dates[1], 'Dates must be in ascending order');
  assert(Boolean(options.repo) !== Boolean(options.boards), 'Supply exactly one of --repo or --boards');
  const inputs = [], boards = [new Map(), new Map()], exDocs = [null, null], sizeManifests = [null, null];
  function remember(source, bytes) { inputs.push({ source, sha256: sha(bytes) }); return parse(bytes); }
  function file(p, root = path.dirname(p)) { return remember(path.resolve(p), sourceFile(p, root)); }
  const repo = options.repo ? fs.realpathSync(options.repo) : null;
  if (repo) for (const f of folders) assert(!inside(repo, f), 'Repository snapshots are not artifact inputs');
  function git(args) { return cp.execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  const ref = repo ? git(['rev-parse', 'origin/main']).trim() : null;
  function gitJSON(p) { return remember(`${ref}:${p}`, git(['show', `${ref}:${p}`])); }
  for (let i = 0; i < 2; i++) {
    const manifestPath = path.join(folders[i], '_manifest-size-exits.json');
    if (fs.existsSync(manifestPath)) {
      const m = file(manifestPath, folders[i]);
      assert(m?.schema === 'size-exits/v2' && typeof m.known === 'boolean' && m.runDate === dates[i] && Array.isArray(m.exits), 'Invalid/stale size-exits/v2 manifest');
      sizeManifests[i] = m;
    }
    const prefix = `board-history/${dates[i]}`;
    const dir = options.boards && path.join(fs.realpathSync(options.boards), dates[i]);
    const names = sorted(repo ? git(['ls-tree', '--name-only', `${ref}:${prefix}`]).trim().split(/\r?\n/) : fs.readdirSync(dir));
    for (const name of names.filter(n => n.endsWith('.json'))) {
      if (['calibration.json', 'regime.json'].includes(name)) continue;
      assert(/^[a-zA-Z0-9_-]+\.json$/.test(name), 'Invalid board filename');
      const b = repo ? gitJSON(`${prefix}/${name}`) : file(path.join(dir, name), options.boards);
      if (['_excluded.json', 'excluded.json'].includes(name)) { exDocs[i] = b; continue; }
      assert(b.date === dates[i] && b.cohort && typeof b.cohort === 'object', `Wrong date or missing cohort: ${name}`);
      if (b.cohortCount !== undefined) assert.deepEqual(sorted(Object.keys(b.cohort)), sorted(Object.keys(b.cohortCount)), 'Missing declared board cohort');
      for (const [cohort, rows] of Object.entries(b.cohort)) {
        assert(Array.isArray(rows), 'Invalid cohort');
        const tickers = new Set();
        for (const r of rows) { assert(typeof r.ticker === 'string' && !tickers.has(r.ticker), `Duplicate/invalid ticker in ${name}/${cohort}`); tickers.add(r.ticker); }
        if (b.cohortCount?.[cohort] !== undefined) assert.equal(rows.length, b.cohortCount[cohort], 'Truncated board cohort');
      }
      boards[i].set(name.slice(0, -5), b);
    }
    if (options[i ? 'excluded-after' : 'excluded-before']) exDocs[i] = file(options[i ? 'excluded-after' : 'excluded-before']);
    if (exDocs[i]) {
      const d = exDocs[i].generated_at?.slice(0, 10) || exDocs[i].date;
      assert.equal(d, dates[i], 'Stale/undated excluded.json');
    }
  }
  assert(boards[0].size, 'No board files');
  assert.deepEqual([...boards[0].keys()], [...boards[1].keys()], 'Board file sets differ; missing files must not manufacture exits');
  const table = options['hand-table'] ? file(options['hand-table']) : repo ? gitJSON('configs/financial-known-cases.json') : null;
  assert(table && Array.isArray(table.cases), 'Supply --hand-table with the origin/main financial-known-cases.json');
  return { folders, dates, inputs, boards, exDocs, sizeManifests, table, ref, repo };
}
/**
 * Compare validated daily inputs without writing files or recomputing scores.
 * @param {object} data Loaded inputs.
 */
function analyze(data) {
  const { folders, dates, boards, exDocs, sizeManifests, table } = data;
  const universe = boards.map(bs => {
    const m = new Map();
    for (const [board, b] of bs) for (const [cohort, rows] of Object.entries(b.cohort)) for (const row of rows) {
      if (!m.has(row.ticker)) m.set(row.ticker, []);
      m.get(row.ticker).push({ board, cohort, row });
    }
    return m;
  });
  const details = new Map(), snapshots = { before: 0, after: 0, removed: 0, added: 0, common: 0, changedFundamentals: 0 };
  const hashes = [crypto.createHash('sha256'), crypto.createHash('sha256')];
  const indexes = folders.map((dir, i) => {
    const index = new Map();
    for (const name of sorted(fs.readdirSync(dir).filter(n => n.endsWith('.json') && !/^_manifest(?:[.-].*)?\.json$/.test(n) && n !== '_last_good_disk.json'))) {
      const bytes = sourceFile(path.join(dir, name), dir), s = parse(bytes);
      assert(s.meta && typeof s.meta.ticker === 'string', `Invalid snapshot identity: ${name}`);
      assert(typeof s.meta.asOf === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(s.meta.asOf) && Number.isFinite(Date.parse(s.meta.asOf)) && new Date(s.meta.asOf.slice(0, 10)).toISOString().slice(0, 10) === s.meta.asOf.slice(0, 10) && s.meta.asOf.slice(0, 10) <= dates[i], `Undated/future snapshot: ${dir}/${name}`);
      assert(!index.has(s.meta.ticker), `Duplicate snapshot ticker: ${s.meta.ticker}`);
      const digest = sha(bytes);
      index.set(s.meta.ticker, { name, digest });
      hashes[i].update(name + '\0' + digest + '\n');
    }
    return index;
  });
  for (const ticker of sorted(new Set(indexes.flatMap(m => [...m.keys()])))) {
    const locations = indexes.map(m => m.get(ticker));
    const pair = locations.map((entry, i) => {
      if (!entry) return null;
      const bytes = sourceFile(path.join(folders[i], entry.name), folders[i]);
      assert.equal(sha(bytes), entry.digest, 'Snapshot changed during comparison');
      return parse(bytes);
    });
    const [a, b] = pair;
    if (a) snapshots.before++;
    if (b) snapshots.after++;
    if (a && !b) snapshots.removed++;
    if (!a && b) snapshots.added++;
    const deltas = a && b ? differences(a, b) : [];
    if (a && b) { snapshots.common++; if (deltas.some(e => /^(timeseries|annual)\./.test(e.field))) snapshots.changedFundamentals++; }
    const old = universe[0].get(ticker)?.[0]?.row, fresh = universe[1].get(ticker)?.[0]?.row;
    const hands = tableEvidence(ticker, a, b, old, fresh, table.cases);
    details.set(ticker, {
      ticker, name: (b || a).meta.name || ticker, presentBefore: !!a, presentAfter: !!b, snapshotDates: dates,
      sources: locations.map((e, i) => e ? path.join(folders[i], e.name) : null), sha256: locations.map(e => e?.digest ?? null), asOf: pair.map(s => present(s?.meta.asOf)),
      fetchedAt: pair.map(s => present(s?.meta.fetchedAt)), mostRecentQuarter: pair.map(s => present(s?.meta.mostRecentQuarter)),
      periodEnds: pair.map(s => present(s?.timeseries?.revenueQEnds)), newestRevenuePeriod: pair.map(newest),
      marketCapUSD: pair.map(s => present(s?.marketCap?.value)), marketCap: pair.map(s => present(s?.marketCap)), pullMode: pair.map(s => present(s?._pullMode)),
      deltas, handTable: hands, inputClass: classify(a, b, deltas, hands.confirmed)
    });
  }
  const exMaps = exDocs.map((doc, i) => exclusions(doc, sizeManifests[i])), rows = [], counts = [];
  const sizeKnown = exDocs.map((doc, i) => sizeManifests[i]?.known ?? (typeof doc?.sizeExitsKnown === 'boolean' ? doc.sizeExitsKnown : null));
  for (const board of boards[0].keys()) {
    const pair = boards.map(bs => bs.get(board)), count = { board, before: 0, after: 0, exits: 0, entries: 0, moves20: 0 };
    for (const cohort of sorted(new Set(pair.flatMap(b => Object.keys(b.cohort))))) {
      const maps = pair.map(b => new Map((b.cohort[cohort] || []).map(r => [r.ticker, r])));
      count.before += maps[0].size; count.after += maps[1].size;
      for (const ticker of sorted(new Set(maps.flatMap(m => [...m.keys()])))) {
        const [old, fresh] = maps.map(m => m.get(ticker));
        const detail = details.get(ticker) || { ticker, name: ticker, presentBefore: false, presentAfter: false, inputClass: 'SNAPSHOT FEHLT', deltas: [], handTable: { confirmed: [], candidates: [] } };
        const event = old ? fresh ? 'changed' : 'exit' : 'entry';
        const rankDelta = Number.isFinite(old?.rank) && Number.isFinite(fresh?.rank) ? fresh.rank - old.rank : null;
        const scoreDelta = Number.isFinite(old?.score) && Number.isFinite(fresh?.score) ? Number((fresh.score - old.score).toFixed(10)) : null;
        if (!fresh) count.exits++;
        if (!old) count.entries++;
        if (rankDelta !== null && Math.abs(rankDelta) >= 20) count.moves20++;
        const changed = !old || !fresh || !equal(old.rank, fresh.rank) || !equal(old.score, fresh.score) || !equal(clean(old.pit), clean(fresh.pit)) || detail.handTable.confirmed.length;
        if (!changed) continue;
        let why = { reasonClass: detail.inputClass, confidencePct: ['NACHLADEN', 'NEUES QUARTAL'].includes(detail.inputClass) ? 95 : 100, silent: false };
        if (event !== 'changed') {
          const target = event === 'exit' ? 1 : 0;
          why = universe[target].has(ticker)
            ? { reasonClass: 'LISTENWECHSEL', confidencePct: 100, silent: false, reason: 'Das Kürzel bleibt in einer anderen vollständigen Liste oder Gewinnkohorte enthalten.' }
            : membership(ticker, event, universe, exMaps, detail, sizeKnown);
        }
        const cls = ['LISTINGWECHSEL', 'BÖRSENWERTGRENZE'].includes(why.reasonClass) ? why.reasonClass : detail.inputClass;
        rows.push({ board, cohort, ticker, name: detail.name, event, rankBefore: present(old?.rank), rankAfter: present(fresh?.rank),
          rankDelta, scoreBefore: present(old?.score), scoreAfter: present(fresh?.score), scoreDelta, class: cls, inputClass: detail.inputClass,
          ...why, evidence: { ...detail, boardSources: dates.map(d => `board-history/${d}/${board}.json`),
            formulaCommits: pair.map(b => present(b.formulaCommit)), exclusions: why.exclusions || [],
            replacement: why.replacementTicker ? details.get(why.replacementTicker) : null,
            pitBefore: present(old?.pit), pitAfter: present(fresh?.pit),
            causality: 'Observed input differences do not isolate their share of a rank or score change.' } });
      }
    }
    counts.push(count);
  }
  const exits = rows.filter(r => r.event === 'exit' && !universe[1].has(r.ticker));
  const entries = rows.filter(r => r.event === 'entry' && !universe[0].has(r.ticker));
  const unique = list => new Set(list.map(r => r.ticker)).size;
  const summary = { dates, snapshots, historyTickers: universe.map(m => m.size), historyExits: unique(exits), historyEntries: unique(entries),
    historyMoves20: counts.reduce((n, c) => n + c.moves20, 0), changedRows: rows.length,
    listingSwitchExits: unique(exits.filter(r => r.reasonClass === 'LISTINGWECHSEL')), floorExits: unique(exits.filter(r => r.reasonClass === 'BÖRSENWERTGRENZE')),
    excludedExits: unique(exits.filter(r => r.reasonClass === 'AUSSCHLUSS')), silentExits: unique(exits.filter(r => r.silent)), silentEntries: unique(entries.filter(r => r.silent)),
    excludedAvailable: exDocs.map(Boolean), sizeManifestAvailable: sizeManifests.map(Boolean), sizeExitsKnown: sizeKnown,
    classCounts: Object.fromEntries(sorted(new Set(rows.map(r => r.class))).map(cls => [cls, rows.filter(r => r.class === cls).length])),
    snapshotHashes: hashes.map(h => h.digest('hex')), boardCounts: counts };
  assert.equal(summary.historyTickers[0] - summary.historyExits + summary.historyEntries, summary.historyTickers[1], 'Unbalanced membership');
  return { summary, rows, exits, entries };
}
function reason(row) {
  if (row.reason) return row.reason;
  if (row.evidence.handTable.confirmed.length) return row.evidence.handTable.confirmed.map(c => `${c.reason} (${c.caseId})`).join(' ');
  const map = { 'NEUES QUARTAL': 'Das jüngste gespeicherte Umsatzquartal ist vorgerückt; eine neue Veröffentlichung ist damit noch nicht belegt.',
    NACHLADEN: 'Fundamentaldaten oder deren Abrufstand wurden nachgeladen.', 'NUR KURS': 'Nur Kurs- und Börsenwertfelder änderten sich; die Ursache der Scorebewegung ist damit nicht bewiesen.',
    'UNVERÄNDERTE EINGABE': 'Die eigenen betrachteten Eingaben sind unverändert; Vergleichsfirmen oder Berechnungsstand können die Position verschieben.',
    'SNAPSHOT FEHLT': 'Mindestens der neuere Firmensnapshot fehlt; der Auslöser ist damit nicht belegt.' };
  let text = map[row.inputClass] || row.inputClass;
  if (row.evidence.handTable.candidates.length) text += ' Die aktuelle Handtabelle enthält passende Fälle; deren erstmalige Wirkung ist aus diesen Eingaben nicht nachgewiesen.';
  return text;
}
/**
 * Render the German summary with ticker counts and evidence gaps.
 * @param {object} s Comparison summary.
 */
function paragraph(s) {
  return `Vom ${s.dates[0]} zum ${s.dates[1]} enthalten die vollständigen Hauptranglisten ${s.historyTickers[1]} statt ${s.historyTickers[0]} Kürzel: ${s.historyExits} Abgänge und ${s.historyEntries} Zugänge. Bei ${s.listingSwitchExits} Abgängen ist der Wechsel zur anderen Notierung derselben Firma belegt, bei ${s.floorExits} die Größenuntergrenze und bei ${s.excludedExits} ein anderer Ausschlussgrund; ${s.silentExits} Abgänge bleiben mit diesen Eingaben ungeklärt. ${s.historyMoves20} historische Positionen verschieben sich um mindestens 20 Plätze. Sicherheit der Zählung 100 %.`;
}
const mdText = s => String(s).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
const mdValue = v => v?.absent ? 'fehlt' : v === null ? 'leer' : v;
/**
 * Render historical movements, silent exits and source limitations.
 * @param {object} result Comparison result.
 * @param {object} data Loaded source metadata.
 * @param {boolean} fullChanges Whether the gzip change list is emitted.
 */
function markdown(result, data, fullChanges = false) {
  const { summary: s, rows, exits } = result;
  // shortcut: history positions only, use dated exports when reporting displayed ranks.
  const priority = r => [r.evidence.handTable.confirmed.length ? 0 : 1, Number.isFinite(r.rankBefore) && r.rankBefore <= 100 || Number.isFinite(r.rankAfter) && r.rankAfter <= 100 ? 0 : 1, -Math.abs(r.scoreDelta || 0), -Math.abs(r.rankDelta || 0)];
  const top = rows.filter(r => r.event === 'changed' && (Math.abs(r.rankDelta) >= 20 || r.evidence.handTable.confirmed.length)).sort((a, b) => {
    const x = priority(a), y = priority(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return cmp(a.board + '/' + a.cohort + '/' + a.ticker, b.board + '/' + b.cohort + '/' + b.ticker);
  }).slice(0, 10);
  const lines = [`**${paragraph(s)}**`, '', '**Zehn auffällige Bewegungen in der Historie**', '',
    'Die Positionsnummern der vollständigen Historie sind keine angezeigten Ränge. Sichtbarkeit und Wachstumsspalten der Kurzlisten sind aus diesen Eingaben nicht feststellbar.', '',
    '| Firma / Kürzel | Liste | Position vorher → nachher | Score vorher → nachher | Grund |', '|---|---|---:|---:|---|',
    ...top.map(r => `| ${mdText(r.name)} (${mdText(r.ticker)}) | ${germanBoards[r.board] || mdText(r.board)} | ${mdValue(r.rankBefore)} → ${mdValue(r.rankAfter)} | ${mdValue(r.scoreBefore)} → ${mdValue(r.scoreAfter)} | ${mdText(reason(r))} Sicherheit ${r.confidencePct} %. |`),
    '', '**Stille Abgänge**', '', 'Hier stehen Abgänge ohne ausreichend belegten Ausschlussgrund. Eine verschwundene Datei allein belegt keine Größenuntergrenze.', '',
    '| Kürzel | Letzte historische Position | Eingangsbeobachtung |', '|---|---:|---|',
    ...exits.filter(r => r.silent).map(r => `| ${mdText(r.ticker)} | ${mdValue(r.rankBefore)} | ${mdText(reason(r))} |`),
    ...(s.silentExits ? [] : ['Keine.']), '', '**Datenstand und Grenzen**', '',
    `Firmensnapshots: ${s.snapshots.before} → ${s.snapshots.after}; ${s.snapshots.removed} fehlen, ${s.snapshots.added} sind neu. Die Verwaltungsdateien _manifest*.json und _last_good_disk.json werden nicht als Firmen gezählt.`, '',
    `Verwendete Snapshot-Ordner: ${data.folders.map(x => '\u0060' + x + '\u0060').join(' und ')}. Ausschlusslisten vorhanden: ${s.excludedAvailable.map(x => x ? 'ja' : 'nein').join(' / ')}. Größenmanifeste vorhanden: ${s.sizeManifestAvailable.map(x => x ? 'ja' : 'nein').join(' / ')}. Größenabgänge erfasst: ${s.sizeExitsKnown.map(x => x === true ? 'ja' : x === false ? 'unbekannt' : 'kein Beleg').join(' / ')}.`, '',
    `${s.silentEntries} Zugänge haben keinen belegten Aufnahmegrund. Die CSVs bewahren fehlende Felder, leere Werte und echte Nullen getrennt. Einordnung „NUR KURS“ beschreibt nur die beobachtete eigene Eingabe, nicht den Auslöser einer Qualitätsbewertung.`, '',
    'Aktuelle Handtabellen belegen ohne datierte Wirkung keinen früheren Einsatz. Bestätigte Rückhalte und Ersetzungen benötigen einen passenden Wechsel in den gespeicherten Quartalseingaben bei passender Währung und Periode. Jahreskorrekturen, Smallcap- und Rule-of-40-Kurzlisten sowie deren Wachstumsanzeigen werden hier nicht rekonstruiert.', '',
    `Belege pro Zeile stehen in abgaenge.csv und zugaenge.csv (Feld evidence)${fullChanges ? ' sowie in aenderungen.csv.gz' : '; die vollständige Änderungsliste wird nur mit --full-changes als aenderungen.csv.gz geschrieben'}. Eingangsprüfsummen, Klassenhäufigkeiten der geänderten Historienzeilen und Zählungen stehen in nachweis.json. Es wurden keine Daten oder Dateien im Repository geändert.`, ''];
  return lines.join('\n');
}
/**
 * Serialize evidence rows with spreadsheet-formula-safe text cells.
 * @param {object[]} rows Comparison rows.
 */
function csv(rows) {
  const columns = ['board', 'cohort', 'ticker', 'name', 'event', 'rankBefore', 'rankAfter', 'rankDelta', 'scoreBefore', 'scoreAfter', 'scoreDelta', 'class', 'inputClass', 'reasonClass', 'confidencePct', 'silent', 'replacementTicker', 'evidence', 'reason'];
  const quote = v => '"' + (v === undefined ? JSON.stringify(present(v)) : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && /^[\s]*[=+@-]/.test(v) ? "'" + v : String(v)).replaceAll('"', '""') + '"';
  return columns.map(quote).join(',') + '\n' + rows.map(r => columns.map(k => quote(r[k])).join(',')).join('\n') + (rows.length ? '\n' : '');
}
/**
 * Write byte-stable results only to an explicit external job directory.
 * @param {object} options Input paths, required out directory and optional full-changes flag.
 */
function run(options) {
  assert(typeof options.out === 'string' && options.out.length, 'Required: --out <external job directory>');
  const out = path.resolve(options.out);
  let existing = out;
  while (!fs.lstatSync(existing, { throwIfNoEntry: false })) existing = path.dirname(existing);
  const target = path.resolve(fs.realpathSync(existing), path.relative(existing, out));
  const checkout = fs.realpathSync(path.resolve(__dirname, '..'));
  assert(!inside(checkout, target), 'Output must stay outside the checkout');
  for (let p = target; ; p = path.dirname(p)) {
    assert(!fs.existsSync(path.join(p, '.git')), 'Output must stay outside any checkout');
    if (p === path.dirname(p)) break;
  }
  const data = load(options);
  const protectedRoots = [...data.folders, ...(data.repo ? [data.repo] : []), ...(options.boards ? [fs.realpathSync(options.boards)] : [])];
  for (const p of protectedRoots) assert(!inside(p, target), 'Output overlaps an input/repository directory');
  const result = analyze(data);
  const files = { [`tagesdifferenz-${data.dates.join('-')}.md`]: markdown(result, data, options['full-changes']),
    'abgaenge.csv': csv(result.exits), 'zugaenge.csv': csv(result.entries),
    'nachweis.json': JSON.stringify({ ...result.summary, sourceRef: data.ref, inputs: data.inputs }, null, 2) + '\n' };
  if (options['full-changes']) files['aenderungen.csv.gz'] = gzipSync(csv(result.rows), { level: 9 });
  for (const [file, content] of Object.entries(files)) {
    const p = path.join(target, file), stat = fs.lstatSync(p, { throwIfNoEntry: false });
    assert(!data.inputs.some(input => path.resolve(input.source) === p), 'Output overlaps an input file');
    if (stat) assert(stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(p).equals(Buffer.from(content)), `Refusing to overwrite different output: ${p}`);
  }
  fs.mkdirSync(target, { recursive: true });
  for (const [file, content] of Object.entries(files)) if (!fs.existsSync(path.join(target, file))) fs.writeFileSync(path.join(target, file), content, { flag: 'wx' });
  return result;
}
if (require.main === module) {
  try {
    const names = ['before', 'after', 'repo', 'boards', 'excluded-before', 'excluded-after', 'hand-table', 'out'];
    const { values } = parseArgs({ options: { ...Object.fromEntries(names.map(n => [n, { type: 'string' }])), 'full-changes': { type: 'boolean', default: false } }, strict: true });
    assert(values.before && values.after, 'Required: --before <YYYYMMDD/snapshots> --after <YYYYMMDD/snapshots> and --repo <repo> OR --boards <root> --hand-table <json>');
    console.log(paragraph(run(values).summary));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { differences, newest, classify, tableEvidence, exclusions, membership, load, analyze, run, paragraph, markdown, csv };
