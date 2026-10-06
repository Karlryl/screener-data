#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { loadRegistry, computeClassesShadow, deviationPct } = require('../lib/mcap-classes-shadow.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const { mcapBandOf, mcapKlasseOf, MCAP_KLASSEN_USD } = require('../src/scoring/score.js');

function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((item) => {
    const file = path.join(dir, item.name);
    return item.isDirectory() ? filesUnder(file) : item.isFile() && item.name.endsWith('.json') ? [file] : [];
  });
}
function validBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 4
    && bounds.every((v, i) => Number.isFinite(v) && v > 0 && (!i || v > bounds[i - 1]));
}
function sizeCheck(row, value, bounds) {
  const complete = value !== null;
  const bandKnown = complete && validBounds(bounds);
  const bandAfter = bandKnown ? mcapBandOf(value, bounds) : null;
  const classAfter = complete ? mcapKlasseOf(value) : null;
  return {
    mcapBand: { before: row.mcapBand ?? null, after: bandAfter,
      changed: bandKnown && row.mcapBand != null ? row.mcapBand !== bandAfter : null,
      reason: !complete ? 'Klassensumme unvollstaendig.' : !bandKnown ? 'Keine gueltigen eingefrorenen mcapBounds in dieser Exportdatei.'
        : row.mcapBand == null ? 'Bisheriges mcapBand fehlt; Klassenwechsel nicht messbar.' : null },
    mcapKlasse: { before: row.mcapKlasse ?? null, after: classAfter,
      changed: complete && row.mcapKlasse != null ? row.mcapKlasse !== classAfter : null,
      reason: !complete ? 'Klassensumme unvollstaendig.' : row.mcapKlasse == null ? 'Bisherige mcapKlasse fehlt; Klassenwechsel nicht messbar.' : null },
  };
}

/**
 * Compares a frozen generation without rerouting, rescoring, sorting or writing inputs.
 * @param {string} snapshotsDir Frozen merged snapshots.
 * @param {string} exportsDir Frozen exports (also accepts the P72 export-full-* filenames).
 * @param {object} [registry] Validated registry, optionally synthetic for tests.
 * @returns {object} Issuer evidence, row-level deviations, fixed-rank and size-class diagnostics.
 */
function buildReport(snapshotsDir, exportsDir, registry = loadRegistry()) {
  const issuers = Object.entries(registry).map(([id, entry]) => {
    const snapshots = new Map(entry.classes.map(({ ticker }) => {
      const file = path.join(snapshotsDir, safeSnapshotFilename(ticker));
      try { return [ticker, read(file)]; }
      catch (err) { if (err.code === 'ENOENT') return [ticker, null]; throw err; }
    }));
    return { id, issuer: entry.issuer, pattern: entry.pattern, source: entry.source,
      shadow: computeClassesShadow(entry, snapshots), rows: [] };
  });
  const byTicker = new Map(issuers.flatMap((issuer) => issuer.shadow.classes.map((leg) => [leg.ticker, issuer])));
  const boards = [];
  const generations = new Set();
  for (const file of filesUnder(exportsDir)) {
    const document = read(file);
    const lists = ['profitable', 'unprofitable', 'rows'].filter((key) => Array.isArray(document[key]));
    if (!lists.length) continue;
    const relative = path.relative(exportsDir, file).split(path.sep).join('/');
    generations.add(document.generated_at ?? null);
    for (const list of lists) {
      const rows = document[list];
      // Diagnostic substitution only: population, score, rank, cohort and order remain fixed.
      const after = rows.map((row) => ({ ...row, marketCap: byTicker.get(row.ticker)?.shadow.value ?? row.marketCap }));
      const tracks = list === 'rows' ? [...new Set(rows.map((row) => row.track ?? 'untracked'))] : [list];
      for (const track of tracks) {
        const indexes = rows.flatMap((row, i) => list !== 'rows' || (row.track ?? 'untracked') === track ? [i] : []);
        const compared = [];
        for (const i of indexes) {
          const row = rows[i];
          const issuer = byTicker.get(row.ticker);
          if (!issuer) continue;
          const item = { board: relative, track, ticker: row.ticker, shown: row.marketCap ?? null,
            shadow: issuer.shadow.value, status: issuer.shadow.status,
            deviationPct: deviationPct(row.marketCap, issuer.shadow.value),
            rank: row.rank ?? null, rankAfter: after[i].rank ?? null,
            rankShift: Number.isFinite(row.rank) ? after[i].rank - row.rank : null,
            sizeClass: sizeCheck(row, issuer.shadow.value, document.mcapBounds) };
          issuer.rows.push(item);
          compared.push(item);
        }
        const over5 = compared.filter((row) => row.deviationPct !== null && Math.abs(row.deviationPct) > 5);
        boards.push({ board: relative, branch: document.branch ?? null, track, population: indexes.length,
          registeredRows: compared.length, completeRows: compared.filter((row) => row.shadow !== null).length,
          incompleteRows: compared.filter((row) => row.shadow === null).length,
          over5Count: over5.length, top20Over5Count: over5.filter((row) => row.rank >= 1 && row.rank <= 20).length,
          over5, sizeChanges: compared.filter((row) => row.sizeClass.mcapBand.changed || row.sizeClass.mcapKlasse.changed),
          mcapBounds: validBounds(document.mcapBounds) ? document.mcapBounds : null,
          populationScoreOrderHeld: indexes.every((i) => rows[i].ticker === after[i].ticker && rows[i].score === after[i].score),
          maxAbsRankShift: Math.max(0, ...compared.map((row) => Math.abs(row.rankShift ?? 0))) });
      }
    }
  }
  if (!boards.length) throw new Error(`${exportsDir}: keine Exportzeilen gefunden`);
  return {
    schema: 'mcap-classes-shadow-report/v1', snapshotsDir: path.resolve(snapshotsDir), exportsDir: path.resolve(exportsDir),
    generations: [...generations],
    method: 'Nur diagnostischer Ersatz des Boersenwerts. Population, Score, Kohorte, Rang und Reihenfolge bleiben fest; keine neue Auswahl oder Score-Berechnung. Rangverschiebung daher 0. Groessenklassen nutzen die importierten Export-Erzeugerfunktionen und ausschliesslich die Grenzen der jeweiligen eingefrorenen Exportdatei; fehlende Vorher-Klassen zaehlen nicht als Klassenwechsel.',
    evidenceDates: 'sharesAsOf und priceAsOf sind Beobachtungszeiten im Snapshot, keine Meldestichtage oder Boersenschlusszeiten. Aktienzahlen und FX sind Anbieter-/Pipeline-Werte, keine amtliche Neuberechnung.',
    counting: 'Emittenten werden nach Register-ID, Boardzeilen nach Exportdatei und Track gezaehlt; mehrere Vorkommen eines Tickers bleiben getrennt.',
    mcapKlasseBounds: MCAP_KLASSEN_USD,
    totals: { registryIssuers: issuers.length, issuersOnBoards: issuers.filter((issuer) => issuer.rows.length).length,
      populationRows: boards.reduce((sum, board) => sum + board.population, 0),
      registeredRows: boards.reduce((sum, board) => sum + board.registeredRows, 0),
      completeRows: boards.reduce((sum, board) => sum + board.completeRows, 0),
      incompleteRows: boards.reduce((sum, board) => sum + board.incompleteRows, 0),
      over5Rows: boards.reduce((sum, board) => sum + board.over5Count, 0),
      top20Over5Rows: boards.reduce((sum, board) => sum + board.top20Over5Count, 0),
      sizeChangeRows: boards.reduce((sum, board) => sum + board.sizeChanges.length, 0),
      maxAbsRankShift: Math.max(0, ...boards.map((board) => board.maxAbsRankShift)) },
    issuers, boards,
  };
}

function markdown(report) {
  const t = report.totals;
  const number = (v) => v === null ? 'offen' : v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const lines = ['> **Auf einen Blick**',
    `> ${t.registeredRows} registrierte Boardzeilen, davon ${t.completeRows} mit Klassensumme und ${t.incompleteRows} mit offener Datenluecke.`,
    `> ${t.over5Rows} Abweichungen ueber 5 %, davon ${t.top20Over5Rows} auf Rang 1 bis 20; ${t.sizeChangeRows} hypothetische Groessenklassenwechsel.`,
    `> Groesste Rangverschiebung bei festgehaltener Population, Score und Reihenfolge: ${t.maxAbsRankShift}.`, '',
    report.method, '', report.evidenceDates, '', report.counting, '', 'Bis zu zehn groesste messbare Abweichungen (je Ticker einmal):', '',
    '| Firma | Ticker | Angezeigt USD | Schatten USD | Abweichung % |', '|---|---|---:|---:|---:|'];
  const ranked = report.issuers.flatMap((issuer) => issuer.rows.map((row) => ({ issuer: issuer.issuer, ...row })))
    .filter((row) => row.deviationPct !== null).sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct));
  const seen = new Set();
  for (const row of ranked) {
    if (seen.has(row.ticker)) continue;
    seen.add(row.ticker);
    lines.push(`| ${row.issuer.replace(/\|/g, '/')} | ${row.ticker} | ${number(row.shown)} | ${number(row.shadow)} | ${number(row.deviationPct)} |`);
    if (seen.size === 10) break;
  }
  lines.push('', 'Die JSON-Datei enthaelt die vollstaendigen Klassenbelege, Zeitstempel, Lueckengruende und Zeilen je Board und Track.');
  return lines.join('\n') + '\n';
}

function inside(file, directory) {
  const relative = path.relative(directory, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

/** Writes only new report files, never frozen inputs or existing outputs. @param {string[]} argv CLI arguments. @returns {object} Report totals. */
function main(argv) {
  const { values } = parseArgs({ args: argv, options: { snapshots: { type: 'string' }, exports: { type: 'string' }, out: { type: 'string' } } });
  if (!values.snapshots || !values.exports || !values.out || !values.out.endsWith('.json')) {
    throw new Error('Aufruf: --snapshots <dir> --exports <dir> --out <neue-datei.json>');
  }
  const snapshotsDir = fs.realpathSync(values.snapshots);
  const exportsDir = fs.realpathSync(values.exports);
  const out = path.join(fs.realpathSync(path.dirname(path.resolve(values.out))), path.basename(values.out));
  const md = out.slice(0, -5) + '.md';
  for (const file of [out, md]) {
    if (inside(file, snapshotsDir) || inside(file, exportsDir) || fs.existsSync(file)) {
      throw new Error(`Geschuetzter oder bereits vorhandener Zielpfad: ${file}`);
    }
  }
  const report = buildReport(snapshotsDir, exportsDir);
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(md, markdown(report), { flag: 'wx' });
  console.log(JSON.stringify(report.totals));
  return report.totals;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
module.exports = { buildReport, main };
