'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./cn-printed-parser');
const { loadBaseline, stripOwn } = require('../lib/exchange-quarter-check');
const { envelope, validUnit } = require('../lib/yahoo-q4-known-cases');
const ROOT = path.resolve(__dirname, '..');
const A_SHARE = /^(?:00\d{4}|30\d{4})\.SZ$|^6\d{5}\.SS$/;
const valueOf = r => r && typeof r === 'object' ? r.value : r;
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

function latestObservation(store, ticker, year) {
  const rows = Object.values(store.companies?.[ticker]?.reports || {}).flat().filter(o => o.periodEnd === year + '-09-30');
  rows.sort((a, b) => (b.noticeDate || '').localeCompare(a.noticeDate || '') ||
    (b.confirmedBy?.at(-1)?.fetchedAt || '').localeCompare(a.confirmedBy?.at(-1)?.fetchedAt || ''));
  const run = Object.values(store.sources).filter(s => s.year === year && s.read.includes(ticker)).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  const error = run?.errors?.find(e => e.ticker === ticker);
  if (error) return { parseStatus: 'unparsed', reason: error.reason };
  return rows[0] || { parseStatus: 'unparsed', reason: 'not-fetched' };
}

function snapshotInfo(snapshot, baseline, year) {
  const s = stripOwn(snapshot), t = s.meta?.ticker, ts = s.timeseries || {};
  const ends = ts.revenueQEnds || [], rows = ts.revenueQ || [];
  const qi = ends.indexOf(year + '-09-30'), pi = ends.indexOf((year - 1) + '-09-30');
  const duplicate = new Set(ends).size !== ends.length;
  const missingPrior = pi < 0 || !Number.isFinite(valueOf(rows[pi]));
  const hasCurrent = qi >= 0 && Number.isFinite(valueOf(rows[qi]));
  const cohort = !baseline.date ? 'baseline-unavailable' : baseline.rows.has(t) ? 'july-row' : 'no-july-row';
  let before = null;
  for (const i of ends.map((_, i) => i).sort((a, b) => ends[b].localeCompare(ends[a]))) {
    const e = ends[i], j = ends.indexOf((Number(e.slice(0, 4)) - 1) + e.slice(4));
    const a = valueOf(rows[i]), b = valueOf(rows[j]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > 0) { before = { periodEnd: e, growthPct: (a / b - 1) * 100 }; break; }
  }
  return { ticker: t, snapshot: s, cohort, missingPrior, hasCurrent, duplicate,
    candidate: missingPrior && hasCurrent && !duplicate, before,
    asOf: s.meta?.asOf?.slice(0, 10) || null };
}

function proposal(info, obs, comparison, dataDay) {
  // A proposed fill needs independent Eastmoney confirmation of the prior year.
  // Keep printed-only in the counts, but never turn it into an eligible proposal.
  if (!info?.candidate || comparison.status !== 'agree') return null;
  if (!info.asOf || info.asOf !== dataDay || obs.noticeDate > dataDay) return { eligible: false, reason: 'snapshot-date-or-notice-date' };
  const env = envelope(info.snapshot), ts = info.snapshot.timeseries;
  const i = ts.revenueQEnds.indexOf(obs.periodEnd), row = ts.revenueQ[i];
  if (!env || env.currency !== 'CNY' || !Number.isFinite(env.factor) || env.factor <= 0 || !validUnit(row, env.storedCurrency)) return { eligible: false, reason: 'snapshot-currency-or-unit' };
  const nativeCurrent = valueOf(row) / env.factor, c = obs.current;
  // No implicit switch from TOTAL_OPERATE_INCOME to OPERATE_INCOME in a snapshot.
  if (Math.abs(nativeCurrent - c.value) > c.roundingHalfWidth + Math.abs(c.value) * 2e-14) return { eligible: false, reason: 'snapshot-current-line-or-value-mismatch' };
  return { eligible: true, priorPeriodEnd: (Number(obs.periodEnd.slice(0, 4)) - 1) + '-09-30', currency: 'CNY',
    beforeCell: null, afterCell: comparison.comparable.value, lower: comparison.comparable.lower, upper: comparison.comparable.upper,
    beforeQuarterPair: info.before, afterQuarterPair: { periodEnd: obs.periodEnd, growthPct: obs.growth.value },
    scope: 'hypothetical-quarter-pair-only-no-score-or-board-switch' };
}

function buildReport({ store, cn, snapshots = [], baseline, year = 2026, dataDay = null }) {
  const infos = snapshots.map(s => snapshotInfo(s, baseline, year));
  const infoMap = new Map(infos.map(i => [i.ticker, i]));
  if (infoMap.size !== infos.length) throw new Error('duplicate-snapshot-ticker');
  const dates = [...new Set(infos.map(i => i.asOf).filter(Boolean))].sort();
  if (!dataDay && dates.length === 1) dataDay = dates[0];
  const tickers = snapshots.length ? infos.map(i => i.ticker).sort() : Object.keys(store.companies).sort();
  const rows = [], counts = {}, cohorts = {}, exchanges = {}, layouts = {}, exchangeLayouts = {}, units = {}, failures = {};
  for (const ticker of tickers) {
    if (!A_SHARE.test(ticker)) continue;
    const info = infoMap.get(ticker);
    let obs = latestObservation(store, ticker, year);
    if (obs.parseStatus === 'parsed') {
      const a = P.eastmoneyAnchor(cn, ticker, year);
      const match = (v, cell) => Number.isFinite(v) && Math.abs(v - cell.value) <= cell.roundingHalfWidth + Math.abs(v) * 2e-14;
      if (!a || !match(a.current, obs.current) || !match(a.ytd, obs.ytd)) obs = { parseStatus: 'unparsed', reason: 'current-store-anchor-changed' };
    }
    const comparison = P.compare(obs, P.eastmoneyAnchor(cn, ticker, year - 1));
    const row = { ticker, cohort: info?.cohort || 'snapshot-unavailable', candidate: info?.candidate || false,
      status: comparison.status, reason: comparison.reason, layout: obs.layout || null,
      unit: obs.unit || null, current: obs.current || null, growth: obs.growth || null,
      priorValues: obs.priorValues || null, comparable: comparison.comparable,
      eastmoneyPrior: comparison.eastmoneyPrior ?? null, announcementId: obs.announcementId || null,
      url: obs.url || null, noticeDate: obs.noticeDate || null, quoteLines: obs.quoteLines || [],
      proposal: dataDay ? proposal(info, obs, comparison, dataDay) : null };
    if (row.status === 'mixed-basis') {
      const absolute = Math.abs(row.comparable.value - row.eastmoneyPrior);
      row.deviation = { absoluteCny: absolute,
        relativePct: row.eastmoneyPrior === 0 ? null : absolute / Math.abs(row.eastmoneyPrior) * 100,
        bandLowerCny: row.comparable.lower, bandUpperCny: row.comparable.upper };
    }
    rows.push(row); bump(counts, row.status);
    const group = cohorts[row.cohort] || (cohorts[row.cohort] = { tickers: 0, candidates: 0, statuses: {}, candidateStatuses: {} });
    group.tickers++; bump(group.statuses, row.status);
    if (row.candidate) { group.candidates++; bump(group.candidateStatuses, row.status); }
    if (row.reason !== 'not-fetched') {
      const ex = ticker.slice(-2), e = exchanges[ex] || (exchanges[ex] = { attempted: 0, parsed: 0 });
      const l = layouts[row.layout || 'unparsed'] || (layouts[row.layout || 'unparsed'] = { attempted: 0, parsed: 0 });
      const key = ex + '/' + (row.layout || 'unparsed');
      const el = exchangeLayouts[key] || (exchangeLayouts[key] = { attempted: 0, parsed: 0 });
      e.attempted++; l.attempted++; el.attempted++;
      if (row.status !== 'unparsed') { e.parsed++; l.parsed++; el.parsed++; bump(units, String(row.unit)); } else bump(failures, row.reason);
    }
  }
  const runs = Object.values(store.sources).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const latestRun = runs.find(r => r.year === year) || null;
  // The 90 percent gate counts only for a live pass run with the CURRENT parser version; a pass of an older parser says nothing about this one.
  const gate = latestRun?.mode === 'live' && latestRun.read.length === 300 && latestRun.parserVersion === P.VERSION ? latestRun.parsed / 300 >= 0.9 : null;
  return { countingLevel: 'ticker', year, dataDay, snapshotDates: dates, snapshotCount: infos.length,
    baselineDate: baseline.date, baselineWarnings: baseline.warnings || [],
    historicalReferenceOnly: { julyPath: 1086, noJulyRow: 1222, note: 'Auftragszahlen aus anderem Stand, keine Nenner dieses Laufs.' },
    counts, cohorts, exchanges, layouts, exchangeLayouts, units, failures, latestRun, gate300: gate,
    proposalState: gate === true ? 'review-required-no-switch' : 'held-until-live-300-gate', rows };
}

function markdown(r) {
  const total = Object.values(r.exchanges).reduce((n, e) => n + e.attempted, 0);
  const parsed = Object.values(r.exchanges).reduce((n, e) => n + e.parsed, 0);
  const lines = ['# China Q3, gedruckte Vergleichszahlen', '', '> **Auf einen Blick**',
    `> ${parsed} von ${total} erfassten Tickern erkannt (${total ? (100 * parsed / total).toFixed(2) : '0'} %).`,
    '> Reine Schattenmessung; keine Board-Zahl wird geändert.',
    `> 300er-Live-Tor: ${r.gate300 === null ? 'noch nicht gemessen' : r.gate300 ? 'bestanden' : 'nicht bestanden; nach diesem Bericht stoppen'}.`, '',
    `Zählebene: Ticker. Snapshot-Stand: ${r.dataDay || 'kein einheitlicher Tag'}. Juli-Vintage: ${r.baselineDate || 'nicht verfügbar'}.`,
    'Die 1.086 und 1.222 im Auftrag stammen aus einem früheren Stand. Hier werden vorhandene Juli-Zeile und fehlende Juli-Zeile am gelieferten Snapshot-Satz gezählt. Eine Juli-Zeile ist keine Freigabe des alten Füllwegs.', '',
    '| Gruppe | Ticker | Q3 aktuell, Vorjahr fehlt | agree | mixed-basis | nur gedruckt | unparsed |',
    '|---|---:|---:|---:|---:|---:|---:|'];
  for (const [name, g] of Object.entries(r.cohorts)) { const c = g.candidateStatuses;
    lines.push(`| ${name} | ${g.tickers} | ${g.candidates} | ${c.agree || 0} | ${c['mixed-basis'] || 0} | ${c['printed-only'] || 0} | ${c.unparsed || 0} |`); }
  lines.push('', 'Die Statusspalten beziehen sich auf die Kandidaten. Nicht abgerufene Ticker sind benannte Lücken und gehen nicht in die Parserquote ein.', '',
    '| Börse / Layout | Erfasst | Erkannt | Quote |', '|---|---:|---:|---:|');
  for (const [k, v] of [...Object.entries(r.exchanges), ...Object.entries(r.exchangeLayouts)]) lines.push(`| ${k} | ${v.attempted} | ${v.parsed} | ${(100 * v.parsed / v.attempted).toFixed(2)} % |`);
  lines.push('', `Vergleich insgesamt: ${JSON.stringify(r.counts)}.`, `Benannte Fehler: ${JSON.stringify(r.failures)}.`, '',
    'Verglichen wird 营业收入 mit Eastmoney OPERATE_INCOME, jeweils Q3 = 9M − H1. 营业总收入 / TOTAL_OPERATE_INCOME wird nicht beigemischt. mixed-basis bezeichnet eine Abweichung außerhalb des Rundungsbands; deren Ursache bleibt ungeklärt.',
    'Bei berichtigten Vergleichsspalten gilt 调整后. Sonst ist das Vorjahr ein aus dem gedruckten Wachstum berechnetes Intervall, keine exakt gedruckte Zahl. Erkennungsbasis für Zeile und Einheit sind zwei Wertanker; verlorene chinesische Textzeichen werden nicht als gelesen ausgegeben.', '',
    '## Abweichungen außerhalb des unveränderten Rundungsbands', '',
    '| Ticker | Gedrucktes Vorjahr / Rechenwert (CNY) | Eastmoney (CNY) | Abstand (CNY) | Relativ zu Eastmoney | Band (CNY) |',
    '|---|---:|---:|---:|---:|---|');
  for (const e of r.rows.filter(e => e.status === 'mixed-basis')) {
    const d = e.deviation;
    lines.push(`| ${e.ticker} | ${e.comparable.value.toFixed(2)} | ${e.eastmoneyPrior.toFixed(2)} | ${d.absoluteCny.toFixed(2)} | ${d.relativePct === null ? 'nicht berechenbar' : d.relativePct.toPrecision(8) + ' %'} | ${d.bandLowerCny.toFixed(3)} bis ${d.bandUpperCny.toFixed(3)} |`);
  }
  lines.push('', 'Die Abweichung wird nur beschrieben; Vergleichsband und Status bleiben unverändert.', '', '## Zehn Belege', '');
  const special = ['000651.SZ', '600031.SS', '300489.SZ', '600871.SS', '688690.SS', '301536.SZ', '688111.SS', '002475.SZ', '002415.SZ', '600808.SS'];
  const examples = [...special.map(t => r.rows.find(x => x.ticker === t && x.url)), ...r.rows.filter(x => x.url)];
  const seen = new Set();
  for (const e of examples) {
    if (!e || seen.has(e.ticker) || seen.size >= 10) continue;
    seen.add(e.ticker);
    const pages = [...new Set(e.quoteLines.map(q => q.page))].join(', ');
    const quote = e.quoteLines.map(q => q.text.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' / ');
    lines.push(`- [${e.ticker}](${e.url}), Seite ${pages || 'unbekannt'}, ${e.status}, Einheit ${e.unit || 'unbekannt'} CNY. Zitat: \`${quote || e.reason}\`.`);
  }
  lines.push('', '## Formelweg, noch nicht freigegeben', '',
    'Vorschlag: ausschließlich fehlende Zellen 2025-09-30 ergänzen, wenn agree vorliegt und Eastmoney damit das Vorjahr unabhängig bestätigt, der aktuelle Snapshot dieselbe Umsatzzeile in belegter Währung und Einheit trägt und der 300er-Lauf mindestens 90 % erreicht. Nur gedruckte Werte ohne diese Bestätigung und Abweichungen bleiben Lücken. Claude und Codex prüfen den konkreten Vorschlag vor jeder Aktivierung.',
    'Die JSON-Zeilen enthalten eine hypothetische Vorher/Nachher-Rechnung des Quartalspaars auf einem Snapshot-Tag. Das ist kein nachgerechneter Board-Score und keine Aktivierung. Bei abweichender aktueller Umsatzzeile wird auch dieser Vorschlag gesperrt.', '');
  return lines.join('\n');
}

function main(opts = {}) {
  if (!opts.snapshots) throw new Error('--snapshots=<directory> is required');
  const storeFile = opts.store || path.join(ROOT, 'external-data/exchange-quarters/cn-printed.json');
  const cnFile = opts.cnStore || path.join(ROOT, 'external-data/exchange-quarters/cn.json');
  const store = read(storeFile), cn = read(cnFile);
  if (store.market !== 'CN-PRINTED' || store.shadow !== true) throw new Error('shadow-store-invalid');
  const filenames = fs.readdirSync(opts.snapshots).filter(f => f.endsWith('.json') && A_SHARE.test(f.slice(0, -5))).sort();
  const inputHash = crypto.createHash('sha256');
  const snapshots = filenames.map(f => { const bytes = fs.readFileSync(path.join(opts.snapshots, f)); inputHash.update(f).update(bytes); return readSnapshot(bytes, f); });
  const baseline = loadBaseline(opts.baselineDir, '2026-08-01');
  const result = buildReport({ store, cn, snapshots, baseline, year: opts.year || 2026, dataDay: opts.dataDay });
  result.inputHashes = { printed: hash(fs.readFileSync(storeFile)), cn: hash(fs.readFileSync(cnFile)), snapshots: inputHash.digest('hex') };
  const out = path.resolve(opts.out || path.join(ROOT, 'outputs/cn-printed-shadow'));
  // Reports must never overwrite an input store or a snapshot.
  for (const f of [out + '.json', out + '.md']) {
    const protectedDirs = ['external-data', 'board-history', 'picks-history', 'score-history', 'methods-history', 'r40rx-history'];
    if ([storeFile, cnFile].some(x => path.resolve(x) === f) || f.startsWith(path.resolve(opts.snapshots) + path.sep) ||
      protectedDirs.some(d => f.startsWith(path.join(ROOT, d) + path.sep))) throw new Error('report-output-is-input');
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out + '.json', JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(out + '.md', markdown(result));
  return result;
}

function readSnapshot(bytes, filename) {
  const s = JSON.parse(bytes.toString());
  if (s.meta?.ticker !== filename.slice(0, -5)) throw new Error('snapshot-ticker-mismatch');
  return s;
}

if (require.main === module) {
  const names = { snapshots: 'snapshots', store: 'store', 'cn-store': 'cnStore', 'baseline-dir': 'baselineDir',
    out: 'out', year: 'year', 'data-day': 'dataDay' }, opts = {};
  try {
    for (const arg of process.argv.slice(2)) { const m = /^--([^=]+)=(.+)$/.exec(arg);
      if (!m || !names[m[1]]) throw new Error('unknown-or-empty-flag');
      opts[names[m[1]]] = m[1] === 'year' ? Number(m[2]) : m[2]; }
    const r = main(opts);
    console.log(JSON.stringify({ counts: r.counts, cohorts: r.cohorts, gate300: r.gate300, proposalState: r.proposalState }));
    process.exitCode = r.gate300 === false ? 1 : 0;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { latestObservation, snapshotInfo, proposal, buildReport, markdown, main };
