#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../configs/non-operating-classes.json');
const { rankGrundShadowFor, validateNonOperatingConfig } = require('../lib/non-operating-classes.js');
const CONFIG_FILE = path.resolve(__dirname, '../configs/non-operating-classes.json');
const SECTIONS = ['profitable', 'unprofitable', 'rows'];
const FAMILIES = ['', 'full', 'quality', 'smallcap', 'rule40'];
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const cell = (value) => String(value ?? 'null').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const csvCell = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';

/**
 * Simulate only the additional rank exclusion, retaining existing gate decisions and order.
 * @param {object[]} rows Frozen rows of ONE ranking sequence (overview is not split by track).
 * @param {string} file Relative list filename for the audit trail.
 * @param {string} section Array key in that file.
 * @returns {object} Affected rows and rank moves; input rows are never mutated.
 */
function simulateList(rows, file, section) {
  let before = 0, after = 0;
  const affected = [], moved = [];
  for (const row of rows) {
    if (!row || typeof row.ticker !== 'string' || !row.ticker) throw new Error(file + ': Ticker fehlt');
    const gated = row.rankGrund != null;
    if (gated ? row.rank !== null : row.rank !== ++before) {
      throw new Error(file + '/' + section + ': ungültige bestehende Rangfolge bei ' + row.ticker);
    }
    const code = rankGrundShadowFor(row.ticker);
    const rankAfter = gated || code ? null : ++after;
    const event = {
      ticker: row.ticker, name: row.name ?? '', class: code, list: file, section,
      track: row.track ?? section, rankBefore: row.rank, rankAfter,
    };
    if (code) affected.push(event);
    else if (row.rank !== rankAfter) moved.push(event);
  }
  return { affected, moved };
}

/**
 * Read just the two writers' export families, hashing the exact bytes being inspected.
 * @param {string} outputs Frozen outputs directory, never a destination.
 * @returns {object} Frozen files, timestamps and list rows.
 */
function readGeneration(outputs) {
  const root = fs.realpathSync(path.resolve(outputs));
  const base = path.join(root, 'findash-export', 'v1');
  const inputs = [], lists = [];
  let generatedAt = null;
  for (const family of FAMILIES) {
    const dir = path.join(base, family);
    // A missing family would silently undercount affected rows (review finding): fail loud instead.
    if (family && !fs.existsSync(dir)) throw new Error('Exportfamilie fehlt in der Eingabe: ' + family);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'excluded.json') continue;
      const filename = path.join(dir, entry.name);
      const bytes = fs.readFileSync(filename);
      const data = JSON.parse(bytes.toString('utf8'));
      const relative = path.relative(root, filename).split(path.sep).join('/');
      if (data.schema !== 'findash-export/v1' || typeof data.generated_at !== 'string'
          || !Number.isFinite(Date.parse(data.generated_at))) throw new Error(relative + ': Exportstempel fehlt');
      inputs.push({ file: relative, sha256: sha256(bytes), generatedAt: data.generated_at });
      if (!family && entry.name === 'index.json') generatedAt = data.generated_at;
      if (entry.name === 'index.json' || entry.name === 'survival.json') continue;
      let sections = 0;
      for (const section of SECTIONS) {
        if (data[section] === undefined) continue;
        if (!Array.isArray(data[section])) throw new Error(relative + ': Liste ist kein Array');
        sections++;
        lists.push({ file: relative, section, rows: data[section] });
      }
      if (!sections) throw new Error(relative + ': keine bekannte Rangliste');
    }
  }
  if (!generatedAt || !lists.length) throw new Error('Exportgeneration ohne Index oder Ranglisten');
  if (inputs.some((input) => input.generatedAt.slice(0, 10) !== generatedAt.slice(0, 10))) {
    throw new Error('Gemischte Exporttage in der Eingabe');
  }
  return { root, generatedAt, inputs, lists };
}

/**
 * Pin the brief's five anchor observations; a missing anchor must stop publication of a result.
 * @param {object} result Affected rows and moved rows of the frozen generation.
 * @returns {string[]} Missing observations, empty only when all five anchors are present.
 */
function anchorProblems(result) {
  const has = (events, ticker, file, track, before, after) => events.some((row) => row.ticker === ticker
    && row.list === 'findash-export/v1/' + file && row.track === track
    && row.rankBefore === before && row.rankAfter === after);
  const checks = [
    [result.affected, 'BURE.ST', 'financials.json', 'unprofitable', 1, null],
    [result.affected, 'FMONC.PA', 'financials.json', 'unprofitable', 17, null],
    [result.affected, 'SBR', 'energy.json', 'profitable', 80, null],
    [result.moved, 'FRU.TO', 'energy.json', 'profitable', 87, 86],
    [result.moved, 'BSM', 'energy.json', 'profitable', 100, 99],
  ];
  return checks.filter((args) => !has(...args)).map(([, ticker, file, track, before, after]) =>
    `${ticker}, ${file}, ${track}, ${before} → ${after ?? 'null'}`);
}

/**
 * Build a deterministic German report from frozen exports; no production export is written.
 * @param {object} generation Result of readGeneration, or a small in-memory test generation.
 * @returns {object} Markdown, CSV, events and any failed acceptance anchors.
 */
function buildShadowReport(generation) {
  validateNonOperatingConfig(config);
  // Declare the boundary in the header BEFORE computing any simulated ranks.
  const header = [
    '# Nicht-operative Klassen: Schattenvergleich vom 03.10.2026', '',
    `Exportgeneration: **${generation.generatedAt}**. Klassentabelle geprüft am ${config.evidenceAsOf}.`, '',
    '## Vorab festgelegte Klassengrenze', '', config.boundary, '',
    'Krypto-Schwelle vor dem Lauf: **0,5 der Bilanzsumme**. Keine Anpassung an die Ergebnisse.', '',
    '## Eingaben und SHA256', '',
    `Klassentabelle: \`configs/non-operating-classes.json\`, SHA256 \`${sha256(fs.readFileSync(CONFIG_FILE))}\`.`, '',
    '| Eingabedatei | Generationsstempel | SHA256 |', '|---|---|---|',
    ...generation.inputs.map((input) => `| ${cell(input.file)} | ${cell(input.generatedAt)} | ${input.sha256} |`), '',
    'P66-Quellen (Dateistand der gelieferten Klassifikation, keine zusätzliche Netzprüfung):', '',
    ...config.p66Inputs.map((input) => `* \`${input.file}\`: SHA256 \`${input.sha256}\``), '',
  ];
  const affected = [], moved = [];
  for (const list of generation.lists) {
    const events = simulateList(list.rows, list.file, list.section);
    affected.push(...events.affected);
    moved.push(...events.moved);
  }
  const problems = anchorProblems({ affected, moved });
  if (!generation.generatedAt.startsWith('2026-10-03T')) problems.unshift('Eingabe ist nicht die Generation vom 03.10.2026');
  const lines = [
    ...header, '> **Auf einen Blick**', '>',
    `> ${problems.length ? '**STOPP: Pflichtbelege fehlen; die Klassengrenze wurde nicht verändert.**' : '**Die Schattenkennzeichnung ändert keine ausgelieferten Ränge oder Scores.**'}`,
    `> * ${affected.length} betroffene Listenzeilen, davon ${affected.filter((row) => row.rankBefore !== null).length} bisher mit Rang.`,
    `> * ${moved.length} weitere Listenzeilen würden bei einer späteren Aktivierung nachrücken.`,
    '> * Survival bleibt vollständig ausgenommen.', '',
    ...problems.map((problem) => '* Fehlender Pflichtbeleg: ' + problem), '',
    '## Bedeutung und Grenzen', '',
    'Dies ist eine statische Gegenrechnung mit der ausdrücklich fixierten Klassentabelle. Sie ist kein historischer Wirksamkeitsnachweis und behauptet nicht, dass jede am 06.10. recherchierte Einstufung bereits am 03.10. bekannt war. Keine Neuberechnung von Score, Perzentilen oder Universum.', '',
    'Gezählt werden Listenzeilen, nicht Unternehmen: Topliste, Vollboard, Quality, Smallcap und Übersicht zählen getrennt. Jede profitable/unprofitable-Liste wird einzeln nummeriert; eine flache Übersicht bleibt eine gemeinsame Rangfolge über alle Tracks. Bereits gesetzte rankGrund bleiben wirksam und verbrauchen weiterhin keine Rangnummer. Betroffene Zeilen ohne bisherigen Rang erscheinen ebenfalls.', '',
    'Mitgliedschaft ist tickerbezogen und endlich. Abwesenheit aus der Tabelle bedeutet keine bestätigte operative Tätigkeit. Die Quelle p66://nicht-operative-universum.csv#TICKER verweist auf die gehashte P66-Eingabe; ihr Zitat ist ein Originalauszug der dortigen Regel, kein erfundenes Unternehmenszitat. Wo P66 kein Primärzitat liefert, wird genau dieser Regelbeleg verwendet. Sicherheit bleibt der P66-Prozentwert; 85 % ist dort ein methodisches Urteil, keine gemessene Einzelfallwahrscheinlichkeit.', '',
    `Regelbelege ohne Originalzitat einer Primärseite: ${config.entries.filter((entry) => entry.sourceUrl.startsWith('p66:')).length} von ${config.entries.length} Einträgen.`, '',
    '## Anzahl je Klasse', '', '| Code | Ticker in Tabelle | betroffene Listenzeilen | davon bisher mit Rang |', '|---|---:|---:|---:|',
    ...Object.keys(config.classes).map((code) => `| ${code} | ${config.entries.filter((entry) => entry.class === code).length} | ${affected.filter((row) => row.class === code).length} | ${affected.filter((row) => row.class === code && row.rankBefore !== null).length} |`), '',
    '## Abweichend von P66 und ausdrücklich ausgenommen', '',
    ...config.remappings.map((entry) => `* **${entry.ticker}**: ${entry.from} → ${entry.to ?? 'kein Schattenkennzeichen'}. ${entry.reason} Quelle: [P66-Primärverweis](${entry.sourceUrl}), „${entry.sourceQuote}“. Sicherheit aus P66: ${entry.confidence} %.`), '',
    ...config.notes.map((note) => '* ' + note), '',
    '## Krypto-Kandidaten', '',
    '| Ticker | Bilanzdatum | digitale Vermögenswerte (Buchwert) | Bilanzsumme | Währung | Anteil | Aufnahme | Sicherheit aus P66 |', '|---|---|---:|---:|---|---:|---|---:|',
    ...config.cryptoCandidates.map((entry) => `| ${entry.ticker} | ${entry.balanceSheetDate ?? 'nicht belegt'} | ${entry.digitalAssets ?? 'nicht belegt'} | ${entry.totalAssets ?? 'nicht belegt'} | ${entry.currency ?? 'nicht belegt'} | ${entry.share == null ? 'nicht messbar' : (100 * entry.share).toFixed(6) + ' %'} | ${entry.included ? 'ja' : 'nein'} | ${entry.confidence} % |`), '',
    ...config.cryptoCandidates.map((entry) => `* **${entry.ticker}**: ${entry.note} [Originalquelle](${entry.sourceUrl}); „${entry.sourceQuote}“.`), '',
    '## Jede betroffene Listenzeile', '',
    '| Ticker | Name | Klasse | Listendatei | Liste | Track | Rang vorher → nachher (Simulation) |', '|---|---|---|---|---|---|---|',
    ...affected.map((row) => `| ${cell(row.ticker)} | ${cell(row.name)} | ${row.class} | ${row.list} | ${row.section} | ${cell(row.track)} | ${row.rankBefore ?? 'null'} → null |`), '',
    '## Jede nachrückende Listenzeile', '',
    '| Ticker | Listendatei | Liste | Track | Rang vorher → nachher (Simulation) |', '|---|---|---|---|---|',
    ...moved.map((row) => `| ${cell(row.ticker)} | ${row.list} | ${row.section} | ${cell(row.track)} | ${row.rankBefore} → ${row.rankAfter} |`), '',
  ];
  const csv = [
    ['art', 'ticker', 'name', 'klasse', 'listendatei', 'liste', 'track', 'rang_vorher', 'rang_nachher'],
    ...affected.map((row) => ['betroffen', row.ticker, row.name, row.class, row.list, row.section, row.track, row.rankBefore ?? 'null', 'null']),
    ...moved.map((row) => ['nachrueckend', row.ticker, row.name, '', row.list, row.section, row.track, row.rankBefore, row.rankAfter]),
  ].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  return { markdown: lines.join('\n'), csv, affected, moved, problems };
}

/**
 * Reject destinations inside the read-only generation, including aliased parent paths.
 * @param {string} outputs Input generation directory.
 * @param {string} out Markdown output path; CSV uses the same stem.
 * @returns {object} Canonical Markdown and CSV destinations.
 */
function reportPaths(outputs, out) {
  if (typeof out !== 'string' || !out.endsWith('.md')) throw new Error('--out muss eine .md-Datei sein');
  const root = fs.realpathSync(path.resolve(outputs));
  const resolved = path.join(fs.realpathSync(path.dirname(path.resolve(out))), path.basename(out));
  const csv = resolved.slice(0, -3) + '.csv';
  for (const target of [resolved, csv]) {
    const canonical = fs.existsSync(target) ? fs.realpathSync(target) : target;
    const relative = path.relative(root, canonical);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Berichtsziel liegt in der schreibgeschützten Eingabe');
    }
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Berichtsziel ist ein Link');
  }
  return { markdown: resolved, csv };
}

/**
 * Verify that the read-only generation still matches the bytes used in the report.
 * @param {object} generation Loaded generation with input paths and SHA256 digests.
 * @returns {void} Throws on any changed or missing input.
 */
function verifyGeneration(generation) {
  for (const input of generation.inputs) {
    if (sha256(fs.readFileSync(path.join(generation.root, input.file))) !== input.sha256) {
      throw new Error('Eingabe während des Berichts verändert: ' + input.file);
    }
  }
}

/**
 * Run the report CLI; missing anchors produce a STOP report and a nonzero exit status.
 * @param {string[]} args Command-line arguments (--outputs directory --out report.md).
 * @returns {number} Zero on a complete report, one on missing required evidence.
 */
function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--outputs', '--out'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Ungültige Argumente');
    options[args[i]] = args[i + 1];
  }
  if (!options['--outputs'] || !options['--out']) throw new Error('Aufruf: --outputs <dir> --out <file.md>');
  const targets = reportPaths(options['--outputs'], options['--out']);
  const generation = readGeneration(options['--outputs']);
  const result = buildShadowReport(generation);
  // Verify the source bytes before AND after writing. No source path is ever a write target.
  verifyGeneration(generation);
  fs.writeFileSync(targets.markdown, result.markdown, 'utf8');
  fs.writeFileSync(targets.csv, result.csv, 'utf8');
  verifyGeneration(generation);
  console.log(`Schattenbericht: ${result.affected.length} betroffene Zeilen, ${result.moved.length} Rangverschiebungen, ${result.problems.length} fehlende Pflichtbelege.`);
  if (result.problems.length) console.error('STOPP: ' + result.problems.join('; '));
  return result.problems.length ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error('::error::' + error.message); process.exitCode = 1; }
}

module.exports = { simulateList, readGeneration, anchorProblems, buildShadowReport, reportPaths, verifyGeneration, main };
