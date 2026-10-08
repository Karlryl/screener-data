#!/usr/bin/env node
'use strict';
/**
 * scripts/exchange-check-report.js — Tag 1403 (G2b) SHADOW report of the exchange cross-check.
 *
 *   node scripts/exchange-check-report.js --out <file.json> [--snapshots DIR] [--outputs DIR]
 *        [--store DIR] [--board-history DIR] [--active-outputs DIR] [--must-withhold T1,T2,...]
 *   --mode fill-only --out <file.md> --reference <shadow.json> writes the off/fill-only
 *   comparison and a sibling CSV, including every consumed input's SHA256.
 *
 * READS ONLY: snapshots (default snapshots/), the exported lists of the same run (default outputs/:
 * every ranked list under findash-export/v1 — branch top lists, overview, quality, survival, rule40 and
 * the full/<branch> cohort lists; excluded.json is not a list), the committed exchange store and
 * board-history (baseline of the fill). WRITES --out (plus its sibling CSV in fill-only). Changes no snapshot, score, export or vintage: the step runs here in mode
 * shadow (lib/exchange-quarter-check.js), independently of the readers' committed mode.
 *
 * Per board row of the China and Taiwan cohorts one of agree | would-withhold | would-withhold-growth |
 * would-fill | unchecked(<why>), with vendor and exchange values, pairs, stratum, boards and ranks, and for
 * every would-* row the reader effects of the active step on that row (growth leg and value, acceleration,
 * lamps). --active-outputs: outputs of a sandbox run with mode active on the same snapshots; adds score and
 * rank after. Census (`census`): every China/Taiwan row whose category is would-*, on a board or not, with
 * every list it is on and its full-list rank (go criterion of G2c: 0 false holds after each listed row is
 * checked against the filing). `boardRows`: every China/Taiwan row on a visible list (all but full/).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const X = require('../lib/exchange-quarter-check.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { revAcceleration } = require('../src/scoring/axes.js');
const { evaluateLamps } = require('../src/scoring/lamps.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };
const round = x => Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x;

/** Every exported ranked list of one scoring output directory (findash-export/v1, what findash shows):
 * `rows` ticker -> visible list entries (every list but full/), `full` ticker -> full-list entry.
 * rank is the exported rank (null for a shown row without one), position the place in the list. */
function boardsOf(dir, read = readJson) {
  const rows = new Map(), full = new Map(), names = new Map(), v1 = path.join(dir, 'findash-export', 'v1');
  let files = [];
  try {
    files = fs.readdirSync(v1, { recursive: true }).map(f => String(f).split(path.sep).join('/'))
      .filter(f => f.endsWith('.json') && f !== 'excluded.json').sort();
  } catch (_) { /* no export: no lists, the caller warns */ }
  let lists = 0;
  for (const f of files) {
    const j = read(path.join(v1, f)), board = f.slice(0, -5);
    for (const [key, list] of Object.entries(j && typeof j === 'object' && !Array.isArray(j) ? j : {})) {
      if (!Array.isArray(list) || !list.some(r => r?.ticker)) continue;
      lists++;
      list.forEach((r, i) => {
        if (!r?.ticker) return;
        if (r.name) names.set(r.ticker, r.name);
        const e = { board, track: key === 'rows' ? null : key, rank: r.rank ?? null, position: i + 1 };
        if (board.startsWith('full/')) full.set(r.ticker, { ...e, score: r.score ?? null, growth: r.revGrowthYoYPct ?? null });
        else { if (!rows.has(r.ticker)) rows.set(r.ticker, []); rows.get(r.ticker).push(e); }
      });
    }
  }
  return { rows, full, names, lists };
}

// The same hand-table/zero-guard chain as a reader, with exchange processing explicitly off.
const beforeExchange = raw => X.applyExchangeCheck(prepareSnapshot(X.stripOwn(raw), { atPull: true }), { mode: 'off' }).snapshot;

/** Compare scalar cells across the entire snapshot; only added fill provenance is excluded.
 * Numeric and object financial cells represent the same value cell. Counts are not result categories. */
function cellChanges(before, after) {
  const cells = s => {
    const out = new Map();
    const visit = (value, key) => {
      if (/^(timeseries\.revenueQ|annual\.annualRev)\.\d+$/.test(key)) {
        value = value && typeof value === 'object' ? { ...value } : { value: value ?? null };
        delete value.exchangeFill;
      }
      if (value && typeof value === 'object' && Object.keys(value).length) {
        for (const [k, v] of Object.entries(value)) visit(v, key ? key + '.' + k : k);
      } else out.set(key, value && typeof value === 'object' ? JSON.stringify(value) : value);
    };
    visit(s, ''); return out;
  };
  const a = cells(before), b = cells(after), out = { filled: 0, withheld: 0, otherChanged: 0 };
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.has(key) === b.has(key) && Object.is(a.get(key), b.get(key))) continue;
    const match = /^timeseries\.revenueQ\.(\d+)\.value$/.exec(key);
    if (match && before.timeseries.revenueQEnds?.[Number(match[1])] === '2025-09-30' &&
        a.get(key) == null && Number.isFinite(b.get(key))) out.filled++;
    else if (Number.isFinite(a.get(key)) && b.get(key) == null) out.withheld++;
    else out.otherChanged++;
  }
  return out;
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const csvCell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
const mdCell = value => String(value ?? 'nicht vorhanden').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const table = rows => rows.map(r => '| ' + r.map(mdCell).join(' | ') + ' |').join('\n');

/** Strict frozen-input measurement. No defaults to a second store and no snapshot writes. */
function fillOnlyReport(outFile) {
  if (!/\.md$/i.test(outFile) || !arg('reference')) throw new Error('fill-only requires --out <file.md> and --reference <shadow.json>');
  const dirs = Object.fromEntries(['snapshots', 'outputs', 'store', 'board-history'].map(k => [k,
    path.resolve(arg(k, path.join(ROOT, k === 'store' ? 'external-data/exchange-quarters' : k)))]));
  const referencePath = path.resolve(arg('reference')), out = path.resolve(outFile), csv = out.replace(/\.md$/i, '.csv');
  for (const target of [out, csv]) {
    if (target === referencePath || Object.values(dirs).some(d => {
      const rel = path.relative(d, target); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
    })) throw new Error('Report target overlaps a read-only input: ' + target);
  }
  const inputs = new Map(), exportDates = new Set();
  const read = file => {
    const bytes = fs.readFileSync(file); inputs.set(path.resolve(file), sha256(bytes));
    const value = JSON.parse(bytes.toString('utf8'));
    return value;
  };
  const reference = read(referencePath), manifest = read(path.join(dirs.snapshots, '_manifest.json'));
  if (!Array.isArray(reference.census) || !Array.isArray(reference.boardRows)) throw new Error('Invalid reference shadow report');
  const stores = X.loadStores(dirs.store), baseline = X.loadBaseline(dirs['board-history']);
  if (stores.warnings.length || baseline.warnings.length) throw new Error([...stores.warnings, ...baseline.warnings].join('; '));
  for (const k of ['cn', 'tw']) read(path.join(dirs.store, k + '.json'));
  for (const f of fs.readdirSync(path.join(dirs['board-history'], baseline.date)).filter(f => f.endsWith('.json')).sort()) {
    read(path.join(dirs['board-history'], baseline.date, f));
  }
  const B = boardsOf(dirs.outputs, file => {
    const value = read(file);
    if (value?.generated_at) exportDates.add(value.generated_at);
    return value;
  });
  if (!B.lists) throw new Error('No exported ranked lists');
  const ctx = { stores, baseline }, results = new Map(), fills = [], rows = [];
  const counts = { board: { rows: 0, filled: 0, withheld: 0, otherChanged: 0 }, all: { rows: 0, filled: 0, withheld: 0, otherChanged: 0 } };
  const warn = console.warn; console.warn = () => {};
  try {
    for (const f of fs.readdirSync(dirs.snapshots).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort()) {
      const raw = read(path.join(dirs.snapshots, f)), ticker = raw?.meta?.ticker;
      if (!ticker || results.has(ticker)) throw new Error('Missing or duplicate snapshot ticker: ' + f);
      const before = beforeExchange(raw), applied = X.applyExchangeCheck(before, { mode: 'fill-only', context: ctx });
      const after = applied.snapshot, delta = cellChanges(before, after), onBoard = B.rows.has(ticker);
      results.set(ticker, { result: applied.result, onBoard, delta });
      for (const bucket of onBoard ? ['all', 'board'] : ['all']) {
        counts[bucket].rows++;
        for (const key of ['filled', 'withheld', 'otherChanged']) counts[bucket][key] += delta[key];
      }
      if (!delta.filled) continue;
      const k = after.timeseries.revenueQEnds.indexOf('2025-09-30'), cell = after.timeseries.revenueQ[k], fill = cell.exchangeFill;
      if (!fill) throw new Error('Filled cell without provenance: ' + ticker);
      const growth = effects(before, after).growth;
      fills.push({ ticker, onBoard, fill });
      for (const board of B.rows.get(ticker) || []) rows.push([ticker, B.names.get(ticker) || raw.meta.name || '',
        board.board, board.track || '', fill.period, fill.nativeValue, fill.nativeCurrency, cell.value, after.meta.reportingCurrency,
        fill.source, fill.dataDate, fill.fetchedAt, fill.sourceId, JSON.stringify(fill.operands),
        growth.before.pct, growth.before.basis, growth.before.periodEnd, growth.before.priorPeriodEnd,
        growth.after.pct, growth.after.basis, growth.after.periodEnd, growth.after.priorPeriodEnd]);
    }
  } finally { console.warn = warn; }
  const differences = [], referenceCounts = {};
  for (const [scope, source] of [['board', reference.boardRows], ['all', reference.census]]) {
    const expected = new Map(source.filter(r => r.category === 'would-fill').map(r => [r.ticker, r]));
    const actual = new Map(fills.filter(r => scope === 'all' || r.onBoard).map(r => [r.ticker, r]));
    referenceCounts[scope] = expected.size;
    for (const ticker of new Set([...expected.keys(), ...actual.keys()])) {
      const a = actual.get(ticker), e = expected.get(ticker), measured = results.get(ticker);
      if (!a || !e) differences.push([scope, ticker, e ? 'fehlt jetzt' : 'zusätzlich', !measured ? 'Rohsnapshot fehlt' :
        scope === 'board' && !measured.onBoard ? 'In den eingefrorenen Ausgaben auf keinem Board' :
        e ? (measured.result?.fill?.blocked || measured.result?.whyText || measured.result?.why || measured.result?.category || 'Außerhalb der Börsenkohorten') :
        'In den Referenz-Füllzeilen nicht enthalten; aktuelle Prüfung erlaubt die Füllung']);
      else if (e.fill.period !== a.fill.period || e.fill.nativeValue !== round(a.fill.nativeValue)) {
        differences.push([scope, ticker, 'Wert oder Zeitraum abweichend', JSON.stringify({ reference: e.fill, measured: a.fill })]);
      }
    }
    if (reference.counts?.[scope]?.['would-fill'] !== expected.size) differences.push([scope, '', 'Referenzzähler abweichend',
      `Referenz nennt ${reference.counts?.[scope]?.['would-fill']}, enthält aber ${expected.size} Füllzeilen`]);
  }
  if (reference.inputs?.baselineDate !== baseline.date) differences.push(['all', '', 'Vergleichsdatum abweichend',
    `Referenz ${reference.inputs?.baselineDate}, Messung ${baseline.date}`]);
  const headers = ['Ticker', 'Name', 'Board', 'Spur', 'Füllquartal', 'Füllwert Originalwährung', 'Originalwährung',
    'Füllwert Snapshot', 'Snapshot-Währung', 'Quelle', 'Veröffentlichung', 'Abruf', 'Quellen-ID', 'Beobachtungen',
    'Wachstum vorher (%)', 'Basis vorher', 'Periodenende vorher', 'Vorjahresende vorher',
    'Wachstum nachher (%)', 'Basis nachher', 'Periodenende nachher', 'Vorjahresende nachher'];
  const dates = [...exportDates].sort();
  const doc = [
    '> **Auf einen Blick**', '>',
    `> Auf dem eingefrorenen Datenstand wurden ${counts.board.filled} Board- und ${counts.all.filled} Gesamtzellen gefüllt.`,
    `> - Ausgeblendet wurden ${counts.board.withheld} / ${counts.all.withheld} Zellen; sonstige Werte geändert ${counts.board.otherChanged} / ${counts.all.otherChanged} (Board / Gesamt).`,
    `> - Der zeilenweise Abgleich mit den ${referenceCounts.board} / ${referenceCounts.all} Referenzfüllungen ergibt ${differences.length} Abweichungen.`, '',
    '# Börsenfüllung vom 03.10.2026: vorher und nachher', '',
    `Rohdaten abgerufen am ${manifest.pulled_at}; Exportdateien erzeugt von ${dates[0]} bis ${dates.at(-1)}; historischer Vergleich vom ${baseline.date}.`, '',
    '## Messung', '',
    'Vorher ist die bestehende Aufbereitung mit ausgeschaltetem Börsenschritt, nachher derselbe Stand mit ausdrücklich gesetztem fill-only und den eingefrorenen Eingaben. Jede skalare Zelle des gesamten aufbereiteten Snapshots wird verglichen; nur die zusätzlich eingetragene Herkunft exchangeFill wird ausgenommen. Ausgeblendet bedeutet vorhandene Zahl wird leer. Sonstige Änderungen sind alle übrigen Abweichungen außer einer leeren Umsatzquartalszelle vom 30.09.2025, die eine Zahl erhält. Abgeleitetes Wachstum wird separat ausgewiesen, es gehört nicht zu diesen Eingabezellen.', '',
    'Gezählt werden eindeutige Ticker, keine Emittenten. Board bedeutet jede sichtbare Rangliste außer full/ und excluded.json; ein Ticker auf mehreren Boards zählt einmal. Gesamt umfasst alle Rohsnapshots, auch außerhalb Chinas und Taiwans. Die Detailtabelle und CSV enthalten dagegen jede Board-Zugehörigkeit einer gefüllten Firma.', '',
    table([['Bereich', 'Geprüfte Ticker', 'Gefüllte Zellen', 'Ausgeblendete Zellen', 'Sonstige Änderungen'], ['---', '---:', '---:', '---:', '---:'],
      ...['board', 'all'].map(k => [k === 'board' ? 'Boards' : 'Gesamtbestand', counts[k].rows, counts[k].filled, counts[k].withheld, counts[k].otherChanged])]), '',
    '## Abgleich mit der Schattenmessung', '',
    differences.length ? table([['Bereich', 'Ticker', 'Abweichung', 'Ursache/Befund'], ['---', '---', '---', '---'], ...differences]) :
      `Alle ${referenceCounts.board} Board- und ${referenceCounts.all} Gesamtfüllungen stimmen nach Ticker, Quartalsende und Originalwert mit der Referenz überein; weder zusätzliche noch fehlende Füllzeilen. Die Referenzwerte sind auf vier Nachkommastellen gerundet, deshalb gilt dieselbe Rundung nur für diesen Abgleich.`, '',
    '## Gefüllte Board-Zeilen', '',
    `Die ${rows.length} Zeilen zeigen jede Board-Zugehörigkeit; die CSV daneben enthält zusätzlich Quellen-ID und sämtliche Beobachtungen der Herleitung. Werte stehen in vollständigen Währungseinheiten. Wachstum ist auf vier Nachkommastellen gerundet; quarter bedeutet Quartal, year Jahresvergleich, yearNewerRecord neuer belegter Jahresvergleich und none kein belastbarer Vergleich. Nicht datierte Anbieterjahre bleiben ausdrücklich ohne Periodenende.`, '',
    table([['Ticker', 'Name', 'Board / Spur', 'Füllwert / Währung', 'Quelle', 'Veröffentlichung / Abruf', 'Vorher: % / Basis / Ende / Vorjahr', 'Nachher: % / Basis / Ende / Vorjahr'],
      ['---', '---', '---', '---:', '---', '---', '---', '---'],
      ...rows.map(r => [r[0], r[1], r[2] + (r[3] ? ' / ' + r[3] : ''), r[5] + ' ' + r[6], r[9],
        (r[10] || 'nicht vorhanden') + ' / ' + (r[11] || 'nicht vorhanden'), r.slice(14, 18).map(v => v ?? 'nicht vorhanden').join(' / '),
        r.slice(18, 22).map(v => v ?? 'nicht vorhanden').join(' / ')])]), '',
    '## Eingaben und SHA256', '',
    'Jeder tatsächlich gelesene Dateneingang ist mit absolutem Pfad und SHA256 aufgeführt. Alle Prüfsummen wurden vor dem Schreiben erneut geprüft; die Eingaben blieben unverändert. Der Bericht lädt ausschließlich den ausgewählten historischen Vergleichstag aus board-history.', '',
    '<details><summary>Vollständige Eingabeliste</summary>', '',
    table([['Eingabepfad', 'SHA256'], ['---', '---'], ...[...inputs].sort(([a], [b]) => a.localeCompare(b))]), '', '</details>', ''
  ].join('\n');
  for (const [file, hash] of inputs) if (sha256(fs.readFileSync(file)) !== hash) throw new Error('Input changed during measurement: ' + file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, doc);
  fs.writeFileSync(csv, [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n');
  console.log('[exchange-fill-only] ' + JSON.stringify({ counts, referenceCounts, differences, boardMembershipRows: rows.length, inputFiles: inputs.size }));
}

const lampsOf = s => { try { return evaluateLamps(s).active.sort(); } catch (e) { return ['error:' + e.message]; } };
function effects(before, after) {
  const lb = revGrowthLeg(before), la = revGrowthLeg(after);
  const out = {
    growth: { before: { basis: lb.basis, pct: round(lb.pct), periodEnd: lb.periodEnd, priorPeriodEnd: lb.priorPeriodEnd },
      after: { basis: la.basis, pct: round(la.pct), periodEnd: la.periodEnd, priorPeriodEnd: la.priorPeriodEnd } },
    acceleration: { before: round(revAcceleration(before)), after: round(revAcceleration(after)) },
  };
  const a = lampsOf(before), b = lampsOf(after);
  out.lamps = { before: a, after: b, on: b.filter(x => !a.includes(x)), off: a.filter(x => !b.includes(x)) };
  return out;
}

function compactResult(r) {
  return { category: r.category, why: r.why, stratum: r.stratum, line: r.line,
    ...(r.whyText !== undefined ? { whyText: r.whyText } : {}),
    ...(r.noDataCodes !== undefined ? { noDataCodes: r.noDataCodes } : {}),
    pairs: r.pairs.map(p => ({ end: p.end, priorEnd: p.priorEnd, level: p.level, status: p.status,
      vendor: p.vendor.map(round), exchange: p.exchange.map(round), ratio: p.ratio && p.ratio.map(round) })),
    withhold: r.withhold.map(w => ({ period: w.period, level: w.level, vendorNative: round(w.vendorNative), exchangeNative: round(w.exchangeNative) })),
    growth: r.growth, fill: r.fill && { period: r.fill.period, blocked: r.fill.blocked, otherwiseFillable: r.fill.otherwiseFillable || false,
      nativeValue: round(r.fill.nativeValue), source: r.fill.source, dataDate: r.fill.dataDate },
    outsideDisagree: r.outsideDisagree, fillPeriodVendorDisagrees: r.fillPeriodVendorDisagrees };
}

// Board rows whose quarterly growth leg is blocked only by an empty vendor cell at a fill period (the gap rule).
function gapBlocked(s) {
  const ends = s?.timeseries?.revenueQEnds || [], rows = s?.timeseries?.revenueQ || [];
  return X.policy.fillPeriods.some(P => {
    const k = ends.indexOf(P), v = rows[k];
    return k > 0 && (v == null || (typeof v === 'object' && v.value == null)) && revGrowthLeg(s).basis !== 'quarter';
  });
}

function main() {
  const out = arg('out');
  if (!out) { console.error('usage: node scripts/exchange-check-report.js --out <file.json> [...]'); process.exit(2); }
  const mode = arg('mode', 'shadow');
  if (!['shadow', 'fill-only'].includes(mode)) throw new Error('Invalid report mode: ' + mode);
  if (mode === 'fill-only') return fillOnlyReport(out);
  const snapDir = path.resolve(arg('snapshots', path.join(ROOT, 'snapshots')));
  const outputs = path.resolve(arg('outputs', path.join(ROOT, 'outputs')));
  const activeOutputs = arg('active-outputs') ? path.resolve(arg('active-outputs')) : null;
  const must = (arg('must-withhold', '') || '').split(',').filter(Boolean);
  const stores = X.loadStores(path.resolve(arg('store', path.join(ROOT, 'external-data', 'exchange-quarters'))));
  const baseline = X.loadBaseline(path.resolve(arg('board-history', path.join(ROOT, 'board-history'))));
  const ctx = { stores, baseline };
  const B = boardsOf(outputs), A = activeOutputs ? boardsOf(activeOutputs) : null;
  const report = { schema: 'exchange-check-shadow/v1', generatedAt: new Date().toISOString(), mode: 'shadow',
    committedMode: X.policy.mode, tolerance: X.policy.tolerance, fillPeriods: X.policy.fillPeriods,
    inputs: { snapshots: snapDir, outputs, activeOutputs, storeFetchedAt: Object.fromEntries(['cn', 'tw'].map(k =>
      [k, stores[k] ? Object.values(stores[k].sources).map(s => s.fetchedAt).sort().at(-1) : null])), baselineDate: baseline.date },
    warnings: [...stores.warnings, ...baseline.warnings], counts: {}, boardRows: [], census: [], mustWithhold: null, gapBlockedBoardRows: null, twins: null };
  if (!B.lists) report.warnings.push('no exported lists under ' + path.join(outputs, 'findash-export', 'v1') + ': no board rows');
  const cnt = (bucket, key) => { report.counts[bucket] = report.counts[bucket] || {}; report.counts[bucket][key] = (report.counts[bucket][key] || 0) + 1; };
  const checked = [], hk = [], results = new Map();
  let gapAll = 0, gapCnTw = 0, gapFill = 0;
  const log = console.warn; console.warn = () => {};
  try {
    for (const f of fs.readdirSync(snapDir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort()) {
      const raw = readJson(path.join(snapDir, f));
      const t = raw?.meta?.ticker;
      if (!t) continue;
      const onBoard = B.rows.has(t);
      const isCnTw = /\.(SS|SZ|TW|TWO)$/.test(t);
      if (!isCnTw && !(onBoard && /\.HK$/.test(t))) { if (onBoard && gapBlocked(beforeExchange(raw))) gapAll++; continue; }
      const s = beforeExchange(raw);
      if (/\.HK$/.test(t)) { hk.push(s); if (gapBlocked(s)) gapAll++; continue; }
      const r = X.applyExchangeCheck(s, { mode: 'shadow', context: ctx }).result;
      results.set(t, r);
      const key = r.category + (r.why ? '(' + r.why + ')' : '');
      cnt('all', key); cnt('all:' + r.market, key); cnt('all:' + (r.stratum || 'none'), key);
      if (r.category !== 'unchecked') checked.push({ t, s, r });
      const would = r.category.startsWith('would-');
      if (!onBoard && !would) continue;
      const row = { ticker: t, market: r.market, onBoard, boards: B.rows.get(t) || [], fullRank: B.full.get(t) || null, ...compactResult(r) };
      if (would) {
        row.effects = effects(s, X.applyResult(s, r));
        if (A) row.effects.scoreRank = { before: B.full.get(t) || null, after: A.full.get(t) || null, boardsAfter: A.rows.get(t) || [] };
        report.census.push(row);
      }
      if (onBoard) {
        cnt('board', key); cnt('board:' + r.market, key); cnt('board:' + (r.stratum || 'none'), key);
        if (r.fill?.blocked) cnt('board:fillBlocked', r.fill.blocked + (r.fill.otherwiseFillable ? '(otherwise fillable)' : ''));
        if (r.growth) cnt('board:levelWithheldAnnual', r.growth.basisAfter + '/' + r.growth.status);
        if (gapBlocked(s)) { gapAll++; gapCnTw++; if (r.category === 'would-fill') gapFill++; }
        report.boardRows.push(row);
      }
    }
  } finally { console.warn = log; }
  report.gapBlockedBoardRows = { all: gapAll, chinaTaiwan: gapCnTw, wouldFill: gapFill };
  // H-share twins of a checked A-share: every overlapping quarter equal in CNY (to the yuan). Not guarded here.
  const native = s => { const m = s.meta || {}, f = m.fxConverted ? m.fxRateApplied : 1;
    return (s.timeseries?.revenueQ || []).map(x => { const v = typeof x === 'number' ? x : x?.value; return Number.isFinite(v) && f > 0 ? v / f : null; }); };
  const byFirst = new Map();
  for (const c of checked) { const n = native(c.s), e = c.s.timeseries.revenueQEnds;
    const k = e?.[0] + '|' + Math.round(n[0]); if (!byFirst.has(k)) byFirst.set(k, []); byFirst.get(k).push(c); }
  report.twins = [];
  for (const h of hk) {
    const m = h.meta || {};
    if ((m.reportingCurrencyOriginal || m.reportingCurrency) !== 'CNY' || !B.rows.has(m.ticker)) continue;
    const n = native(h), e = h.timeseries?.revenueQEnds || [];
    for (const c of byFirst.get(e[0] + '|' + Math.round(n[0])) || []) {
      const cn = native(c.s), ce = c.s.timeseries.revenueQEnds;
      const overlap = e.map((d, i) => [i, ce.indexOf(d)]).filter(([i, j]) => j >= 0 && n[i] !== null && cn[j] !== null);
      if (overlap.length >= 2 && overlap.every(([i, j]) => Math.abs(n[i] - cn[j]) <= 1)) {
        report.twins.push({ ticker: m.ticker, twinOf: c.t, twinCategory: c.r.category, boards: B.rows.get(m.ticker), overlappingQuarters: overlap.length });
      }
    }
  }
  if (must.length) {
    report.mustWithhold = must.map(t => {
      const r = results.get(t);
      return { ticker: t, category: r ? r.category : 'absent', why: r?.why || null, stratum: r?.stratum || null,
        pass: !!r && (r.category === 'would-withhold' || r.category === 'would-withhold-growth'), onBoard: B.rows.has(t), boards: B.rows.get(t) || [] };
    });
    report.mustWithholdPass = report.mustWithhold.filter(x => x.pass).length + '/' + must.length;
  }
  report.counts.boardRowsChinaTaiwan = report.boardRows.length;
  report.counts.census = report.census.length;
  const old = report.counts.all?.['unchecked(store-old)'];
  if (old) report.warnings.push(`exchange store older than the limit (store-old): ${old} China/Taiwan rows unchecked`);
  const neverRead = report.counts.all?.['unchecked(no-own-read)'];
  if (neverRead) report.warnings.push(`${neverRead} China/Taiwan rows: Börsenquelle hat diese Firma noch nie geliefert (no-own-read)`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(`[exchange-check-shadow] ${JSON.stringify({ board: report.counts.board, census: report.census.length, gapBlocked: report.gapBlockedBoardRows,
    mustWithhold: report.mustWithholdPass || null, twins: report.twins.length, warnings: report.warnings.length })}`);
}

if (require.main === module) main();
module.exports = { boardsOf, gapBlocked, beforeExchange, cellChanges };
