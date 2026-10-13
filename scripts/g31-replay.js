'use strict';

// Offline P184 measurement. Every output stays below the caller's explicit task directory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const [arm, dataDir, workDir, reportDir] = process.argv.slice(2).map((v, i) => i ? path.resolve(v) : v);
assert.ok(['before', 'current', 'v1', 'v2', 'report'].includes(arm), 'Specify before/current/v1/v2/report and absolute data, work and report directories');
assert.ok(dataDir && workDir && reportDir && workDir !== dataDir && !workDir.startsWith(dataDir + path.sep));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const clock = '2026-10-10T09:52:16.684Z';
const sourceFiles = ['src/scoring/axes.js', 'src/scoring/score.js', 'src/scoring/overview.js',
  'lib/rev-growth-basis.js', 'scripts/write-findash-export.js', 'scripts/write-rule40-export.js', 'lib/g31-recency.js'];
const inside = (file, dir) => file === dir || file.startsWith(dir + path.sep);
for (const target of [workDir, reportDir]) {
  assert.ok(!inside(target, dataDir) && !inside(dataDir, target) && !inside(target, root) && !inside(root, target)
    && !/(?:^|[\\/])(?:board-history|picks-history|score-history|methods-history|r40rx-history|lockbox)(?:[\\/]|$)/i.test(target),
  'Output must be an isolated task directory, outside source/data/protected paths');
}
for (const file of sourceFiles) assert.ok(fs.statSync(path.join(workDir, 'baseline', file)).isFile(), 'Baseline source missing: ' + file);
const sourceManifest = Object.fromEntries([...sourceFiles, 'scripts/g31-replay.js'].map(file => {
  const used = arm === 'before' && sourceFiles.includes(file) ? path.join(workDir, 'baseline', file) : path.join(root, file);
  return [file, { path: used, sha256: hash(fs.readFileSync(used)) }];
}));

function report() {
  const read = name => readJSON(path.join(workDir, `${name}.json`));
  const before = read('before'), current = read('current'), arms = { V1: read('v1') };
  const scoreBytes = data => JSON.stringify({ unrounded: data.unrounded,
    boards: Object.fromEntries(Object.entries(data.boards).map(([board, rows]) => [board, rows.map(r => [r.ticker, r.score, r.rank, r.r40 ?? null])])) });
  assert.equal(scoreBytes(current), scoreBytes(before), 'Current unrounded scores and exported scores/ranks must be byte-identical');
  const legacyBytes = data => JSON.stringify(Object.fromEntries(Object.entries(data.boards).map(([board, rows]) => [board,
    rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['g31Shadow', 'g31OverviewShadow'].includes(key))))])));
  assert.equal(legacyBytes(current), legacyBytes(before), 'All legacy row values and key order must be byte-identical');
  const legacyRows = Object.values(JSON.parse(legacyBytes(current))).flat(), currentRows = Object.values(current.boards).flat();
  const bytes = (rows, pretty) => Buffer.byteLength(JSON.stringify(rows, null, pretty ? 2 : undefined));
  const size = Object.fromEntries([false, true].map(pretty => {
    const legacy = bytes(legacyRows, pretty), delivered = bytes(currentRows, pretty);
    const growthPct = (delivered / legacy - 1) * 100;
    assert.ok(growthPct < 15, `Shadow export growth must stay below 15% (${growthPct}%)`);
    return [pretty ? 'indented' : 'compact', { legacy, delivered, growthPct }];
  }));
  for (const data of [current, ...Object.values(arms)]) {
    assert.equal(data.inputDigest, before.inputDigest, 'Identical consumed inputs');
    assert.equal(data.calibrationDigest, before.calibrationDigest, 'Identical calibration');
    assert.deepEqual(data.sourceManifest, current.sourceManifest, 'Same final source bytes in current and shadow arms');
  }
  const sourceProof = { before: before.sourceManifest, current: current.sourceManifest };
  writeJSON(path.join(reportDir, 'quellnachweis.json'), sourceProof);
  writeJSON(path.join(reportDir, 'verifikation.json'), { rows: currentRows.length,
    beforeScoreRankSha256: hash(scoreBytes(before)), afterScoreRankSha256: hash(scoreBytes(current)),
    beforeLegacySha256: hash(legacyBytes(before)), afterLegacySha256: hash(legacyBytes(current)),
    previousReviewScoreRankSha256: '212bc2a492dace1197f79831a85fd87a051158a02b3f623d50ee0a9baa85b6fa',
    previousReviewLegacySha256: 'a7a1a45769bad8e8473f2404cfcb5c8bc4364fdd52a8aaf2ffea68828a330465', size });
  const taiwan = require('../lib/exchange-quarter-store.js').taiwanSeasonValues(current.taiwanEvidence.seasons['115Q2'].at(-1), 115, 2);
  const rows = [], summaries = [], events = [], examples = [];
  for (const [variant, data] of Object.entries(arms)) {
    for (const board of new Set([...Object.keys(before.boards), ...Object.keys(data.boards)])) {
      const old = before.boards[board] || [], next = data.boards[board] || [];
      const a = new Map(old.map(r => [r.ticker, r])), b = new Map(next.map(r => [r.ticker, r]));
      let entries = 0, exits = 0, changed = 0;
      const top = old.filter(r => r.rank !== null && r.rank <= 20).length;
      for (const ticker of new Set([...a.keys(), ...b.keys()])) {
        const x = a.get(ticker), y = b.get(ticker), wasTop = x?.rank != null && x.rank <= 20, isTop = y?.rank != null && y.rank <= 20;
        const event = isTop && !wasTop ? 'Eintritt' : wasTop && !isTop ? 'Austritt' : '';
        if (event === 'Eintritt') entries++; if (event === 'Austritt') exits++;
        if ((x?.rank ?? null) !== (y?.rank ?? null)) changed++;
        const row = { variante: variant, board, ticker, ereignis: event, rang_vorher: x?.rank ?? null, rang_nachher: y?.rank ?? null,
          score_vorher: x?.score ?? null, score_nachher: y?.score ?? null, wachstum_vorher: x?.revGrowthYoYPct ?? null,
          wachstum_nachher: y?.revGrowthYoYPct ?? null, basis: y?.revGrowthBasis ?? null, ende: y?.revGrowthPeriodEnd ?? null };
        rows.push(row); if (event) events.push(row);
        if (['AUGO', 'PENG', '2548.TW'].includes(ticker)) examples.push(row);
      }
      summaries.push({ variant, board, changed, entries, exits, top, turnover: top ? exits / top * 100 : 0 });
    }
  }
  const csv = value => value == null ? '' : '"' + String(value).replaceAll('"', '""') + '"';
  fs.writeFileSync(path.join(reportDir, 'messung.csv'), [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(csv).join(','))].join('\n') + '\n');
  const fmt = x => x == null ? 'leer' : typeof x === 'number' ? x.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : x;
  const table = (headers, entries) => ['| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|',
    ...entries.map(r => '| ' + r.map(fmt).join(' | ') + ' |')].join('\n');
  const totals = Object.keys(arms).map(variant => {
    const all = summaries.filter(r => r.variant === variant);
    return { variant, changed: all.reduce((n, r) => n + r.changed, 0), entries: all.reduce((n, r) => n + r.entries, 0),
      exits: all.reduce((n, r) => n + r.exits, 0), top: all.reduce((n, r) => n + r.top, 0) };
  });
  const displayChanges = { gp: 0, 'revenue-badge': 0 }, affected = new Set(), undated = new Set(), ties = new Set();
  let gpTop20 = 0, undatedRows = 0, tieRows = 0;
  const shadowCoverage = Object.fromEntries(['hg/', 'quality/', 'rule40/'].map(prefix => {
    const data = Object.entries(current.boards).filter(([key]) => key.startsWith(prefix)).flatMap(([, values]) => values);
    return [prefix.slice(0, -1), { rows: data.length, v1: data.filter(r => r.g31Shadow?.v1?.pct != null).length,
      v2: data.filter(r => r.g31Shadow?.v2?.pct != null).length }];
  }));
  for (const [board, old] of Object.entries(before.boards).filter(([b]) => !b.startsWith('rule40'))) {
    const next = new Map(current.boards[board].map(r => [r.ticker, r]));
    for (const x of old) {
      const shadow = next.get(x.ticker)?.g31OverviewShadow;
      const value = Number.isFinite(shadow?.value) ? Math.round(shadow.value * 1000) / 1000 : null;
      if (!shadow || !Object.hasOwn(displayChanges, x.overview?.kind) || x.overview.value === value) continue;
      displayChanges[x.overview.kind]++;
      if (x.overview.kind !== 'gp') continue;
      affected.add(x.ticker); if (x.rank !== null && x.rank <= 20) gpTop20++;
      const evidence = current.overviewEvidence[x.ticker];
      if (!evidence?.annualEnd) { undated.add(x.ticker); undatedRows++; }
      if (evidence?.annualEnd && evidence.annualEnd === evidence.quarterEnd) { ties.add(x.ticker); tieRows++; }
    }
  }
  const sourceBefore = hash(scoreBytes(before)), sourceAfter = hash(scoreBytes(current));
  const lines = ['# P184 Vorher/Nachher auf den Daten vom 10.10.2026', '', '> **Auf einen Blick**',
    '> Alle bisherigen Exportwerte einschließlich Übersicht, Scores, Rängen und Schlüsselreihenfolge sind byte-identisch; B1 bis B5 bleiben im Schatten.',
    `> - V1 ersetzt im Messarm ${totals[0].exits} von ${totals[0].top} bisherigen Top-20-Plätzen. V2 ist mangels acht Quartalen nicht messbar.`,
    `> - Die zusätzlichen Anzeigeschatten weichen in dieser Wiederholung bei ${displayChanges.gp} Bruttogewinnwerten und ${displayChanges['revenue-badge']} Umsatz-Badges vom unveränderten Live-Wert ab.`,
    '> - Die historischen Erzeugungsdateien und der separate Smallcap-Bestand fehlen im erlaubten Datenbereich. Keine Aussage über eine bytegleiche Wiederholung des damaligen veröffentlichten Exports.', '',
    '## Messvertrag', '', `Die tatsächlich geladenen Quelldateien einschließlich der zwingend vorhandenen Vorher-Kopien sind mit SHA256 in quellnachweis.json registriert. Aktuell und V1 verwenden nachweislich dieselben finalen Quellbytes. Uhrzeit in allen Armen: ${clock}.`,
    `${before.snapshotCount} Roh-Snapshots, ${before.universeCount} durch die lokale Produktions-Watchlist autorisiert. Identische Vorbereitung einschließlich Handtabellen, Währungsprüfungen und SEC-Jahresdaten. Die Börsenergänzung bleibt fill-only; mangels freigegebenem historischen Referenzbestand ist ihr Referenzbestand in allen Armen ausdrücklich leer. Deshalb sind Ergänzungen, die diesen Referenzbestand benötigen, nicht nachgebildet.`,
    'Die Kalibrierung wird im Vorher-Arm einmal gelernt und für alle Arme eingefroren, einschließlich Kohorten, Wachstum und Rule40-Begrenzung. Gemessen werden vollständige exportierte Branchen und Gewinnklassen nach Emittentenbereinigung und Rang-Gate, nicht nur bereits veröffentlichte Spitzenwerte. Die Zeile zählt als Board-Platz; dieselbe Firma kann in mehreren Boards vorkommen. Übersichten werden nicht doppelt gezählt. Smallcap ist im Export verdrahtet und synthetisch geprüft, aber sein eigener Datenbestand wurde nicht nachgestellt.',
    'V1 nimmt das neueste gültige Quartals- oder Jahrespaar. Bei gleichem Ende bleibt das Quartal. Ohne belegte Datumsreihen bleibt die vorhandene Positionsregel erhalten und das Ende als unbekannt beschriftet. Der Wachstumsbonus behält den bisherigen Mittelwert der Komponenten, nutzt jedoch das validierte neuere Jahr. V2 ist immer vier gegen vier Quartale bis zum neuesten Quartal, auch wenn ein späteres Geschäftsjahr existiert. Bei fehlenden Quartalen bleiben Wachstum und Bonus leer, ohne Jahresersatz. Die übrigen Achsen, Gewichte und Tore bleiben gleich.',
    `Die zusätzliche P115-Jahresprüfung (334 bis 397 Tage) bleibt wie in der Live-Rechnung ausgeschaltet. P184 liest den bestehenden Schalter und aktiviert ihn nicht. Gegenüber der zuvor versehentlich eingeschalteten Prüfung unterscheiden sich im identischen vorbereiteten Universum ${current.annualRuleEffect.values} V1-Werte und ${current.annualRuleEffect.bonuses} Bonus-Komponentenlisten (${current.annualRuleEffect.any} Firmen insgesamt). Die Rangmessung unten verwendet ausschließlich den korrigierten ausgeschalteten Zustand.`,
    'Der parallele Formelweg beginnt erst mit der Auslieferung durch Claude und dauert höchstens vier Wochen. Ohne anschließende unabhängige Prüfung und Entscheidung bleibt die aktuelle Rangrechnung aktiv.', '',
    '## Bytevergleich', '', '```text', `Scores/Ränge vorher: ${sourceBefore}`, `Scores/Ränge aktuell: ${sourceAfter}`, 'Vergleich: byte-identisch; Abweichungen 0',
    `Input-SHA256: ${before.inputDigest}`, `Kalibrierung-SHA256: ${before.calibrationDigest}`, 'Alle tatsächlich gelesenen Eingabedateien vor/nach jedem Arm unverändert.', '```', '',
    `Alle bisherigen Exportfelder und ihre Reihenfolge: byte-identisch; SHA256 vorher und aktuell ${hash(legacyBytes(current))}. B4/B5 ändern weder aktuelle Übersichtswerte noch Ränge.`, '',
    '## Vollständiger B4-Umfang und spätere Anzeigeumschaltung', '',
    'Die blinde Opus-Prüfung des Masters meldet 12.381 abweichende Bruttogewinnwerte für 6.724 Ticker, darunter 4.856 Ticker ohne jährliches GP-Enddatum und 61 mit gleichem Quartals- und Jahresende; 458 betroffene Plätze liegen in den Top 20. Das ist der vollständige vom Master vorgegebene Umfang, nicht die frühere Beschränkung auf datiert neuere Quartale. Prüfvertrauen des Masters: 85 %.',
    `Die eigene Wiederholung mit der unten beschriebenen lokalen Watchlist zählt ${displayChanges.gp} Werte, ${affected.size} Ticker und ${gpTop20} Top-20-Plätze; davon ${undated.size} Ticker (${undatedRows} Zeilen) ohne jährliches GP-Enddatum sowie ${ties.size} Ticker (${tieRows} Zeilen) mit gleichem Ende. Abweichende Grundgesamtheiten werden nicht gleichgesetzt.`,
    'findash zeigt bisher nur Art und Wert des Übersichtswachstums. Ein zusätzliches Zeitraumfeld würde dort unsichtbar bleiben. Deshalb stehen neuer Wert und Basis ausschließlich in g31OverviewShadow; das Zeitraumetikett ist aus period.basis und period.periodEnd rekonstruierbar. Die Umschaltung von Wert und sichtbarem Etikett erfolgt gemeinsam in einem späteren Paket.', '',
    '## Top-20-Umsatz und Rangänderungen', '', 'Top-20-Umsatz bedeutet Austritte geteilt durch die Zahl vorher besetzter Top-20-Plätze. Rangänderungen schließen Eintritte, Austritte und Wechsel zu oder von einem leeren Rang ein.', '',
    table(['Board-Familie', 'Zeilen', 'V1 vorhanden', 'V1 fehlt', 'V2 vorhanden', 'V2 fehlt'], Object.entries(shadowCoverage).map(([name, c]) => [name, c.rows, c.v1, c.rows - c.v1, c.v2, c.rows - c.v2])), '',
    `V2: nicht messbar. Der gespeicherte Bestand enthält höchstens ${current.maxRevenueQuarters} Quartale; acht wären nötig. In der Master-Prüfung waren 0 von 9.719 HG-Zeilen berechenbar, in dieser Wiederholung 0 von ${shadowCoverage.hg.rows}. Es werden weder V2-Rangänderungen noch V2-Turnover als Ergebnis ausgegeben, auch nicht in messung.csv. Die Implementierung bleibt mit vollständigen synthetischen Acht-Quartals-Fällen geprüft. Sicherheit 100 % für die hier gemessene Datenlücke.`, '',
    table(['Variante', 'Rangänderungen', 'Eintritte', 'Austritte', 'Top-20 vorher', 'Umsatz %'], totals.map(r => [r.variant, r.changed, r.entries, r.exits, r.top, 100 * r.exits / r.top])), '',
    table(['Variante', 'Board', 'Rangänderungen', 'Eintritte', 'Austritte', 'Top-20 vorher', 'Umsatz %'], summaries.map(r => [r.variant, r.board, r.changed, r.entries, r.exits, r.top, r.turnover])), '',
    '## Die drei Beispiele', '', table(['Firma', 'V1 %', 'V1 Zeitraum', 'V2 %', 'V2 Zeitraum oder Lücke'],
      Object.entries(current.examples).map(([ticker, s]) => [ticker, s.v1.pct, s.v1.label, s.v2.pct, s.v2.pct === null ? s.v2.reason : s.v2.label])), '',
    table(['Variante', 'Board', 'Firma', 'Rang vorher', 'Rang nachher', 'Wachstum vorher %', 'Wachstum nachher %'], examples.map(r => [r.variante, r.board, r.ticker, r.rang_vorher, r.rang_nachher, r.wachstum_vorher, r.wachstum_nachher])), '',
    '### Huaku: Börsenbeleg und Halbjahresabgrenzung', '',
    `Die lokal gespeicherte Meldung 115Q2 ergibt mit dem bestehenden Börsenparser ${fmt((taiwan.quarter / taiwan.priorQuarter - 1) * 100)} % für das Einzelquartal und ${fmt((taiwan.ytd / taiwan.priorYtd - 1) * 100)} % für das Halbjahr. Die Originalwerte und Quellüberschriften stehen im folgenden unveränderten Auszug. Ein Halbjahreswachstum ist weder ein einzelnes Quartal noch eine vollständige Acht-Quartals-Reihe und wird deshalb nicht als V2 eingesetzt.`,
    '```json', JSON.stringify(current.taiwanEvidence, null, 2), '```', '',
    '## Alle Top-20-Eintritte und Austritte', '', table(['Variante', 'Board', 'Firma', 'Änderung', 'Rang vorher', 'Rang nachher'], events.map(r => [r.variante, r.board, r.ticker, r.ereignis, r.rang_vorher, r.rang_nachher])), '',
    '## Grenzen und Übergabe', '', 'Die Berechnungen sind reproduziert, die wirtschaftliche Vergleichbarkeit jeder Anbieterzahl ist damit nicht extern bestätigt. Sicherheit 99 % für die gemessene Identität auf diesem Messvertrag; keine gemessene Aussage über Prognosegüte. Claude-Prüfung, Freigabe und Anzeige in der laufenden findash-App stehen aus. Der Auftrag erlaubt nur den Exportvertrag, keine Änderung des findash-Renderers.',
    'B1/B2/B3 wurden jeweils an einer ausschließlich im Speicher veränderten Kopie absichtlich gebrochen; die Tests erkennen alle drei Fehler, die Quellhashes bleiben unverändert. Die Bestandsunterlagen enthalten alte Arbeitsanweisungen; sie wurden als Daten gelesen und nicht als zusätzliche Aufträge ausgeführt.',
    'Brief-Feedback: Der Schattenauftrag ist klar abgegrenzt. Für eine exakte Wiederholung des historischen Exports sollten künftig die Erzeugungs-Watchlist, Börsenreferenz und separaten Smallcap-Snapshots ausdrücklich mit freigegeben werden.', ''];
  fs.writeFileSync(path.join(reportDir, 'vorher-nachher.md'), lines.join('\n'));
  console.log(JSON.stringify({ scoreRankBytesIdentical: true, legacyBytesIdentical: true, scoreRankSha256: sourceBefore,
    legacySha256: hash(legacyBytes(current)), size, totals, shadowDisplayDifferences: displayChanges,
    b4: { tickers: affected.size, top20: gpTop20, undatedTickers: undated.size, undatedRows, tiedTickers: ties.size, tieRows },
    annualRuleEffect: current.annualRuleEffect, v2: 'nicht messbar', shadowCoverage }, null, 2));
}

function measure() {
  const NativeDate = Date;
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return NativeDate.parse(clock); } };
  if (arm === 'before') {
    const compile = Module._extensions['.js'];
    Module._extensions['.js'] = (mod, file) => {
      const relative = path.relative(root, file), backup = path.join(workDir, 'baseline', relative);
      if (sourceFiles.includes(relative.split(path.sep).join('/'))) mod._compile(fs.readFileSync(backup, 'utf8'), file);
      else compile(mod, file);
    };
  }
  const originalRead = fs.readFileSync, originalReaddir = fs.readdirSync;
  const inputs = new Map(), virtual = new Map();
  const forbidden = /(?:^|[\\/])(?:board-history|picks-history|score-history|methods-history|r40rx-history|lockbox)(?:[\\/]|$)|(?:^|[\\/])\.env[^\\/]*$/i;
  fs.readFileSync = (file, options) => {
    const full = path.resolve(String(file)); assert.ok(!forbidden.test(full), 'Forbidden input: ' + full);
    if (virtual.has(full)) return options ? virtual.get(full) : Buffer.from(virtual.get(full));
    const bytes = originalRead(full);
    if (full.endsWith('.json') && !full.startsWith(workDir + path.sep) && !full.startsWith(reportDir + path.sep)) inputs.set(full, hash(bytes));
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? bytes.toString(encoding) : bytes;
  };
  fs.readdirSync = (file, options) => { assert.ok(!forbidden.test(String(file)), 'Forbidden directory'); return originalReaddir(file, options); };
  const X = require('../lib/exchange-quarter-check.js');
  const context = { stores: X.loadStores(path.join(root, 'external-data/exchange-quarters')),
    baseline: { date: null, rows: new Map(), warnings: [] } };
  const hand = require('../lib/yahoo-q4-known-cases.js'), prepare = hand.prepareSnapshot, prepared = new Map();
  hand.prepareSnapshot = raw => {
    if (!raw) return raw;
    const ticker = raw.meta?.ticker;
    if (prepared.has(ticker)) return prepared.get(ticker);
    const result = X.applyExchangeCheck(prepare(raw, { atPull: true }), { context }).snapshot;
    if (ticker) prepared.set(ticker, result);
    return result;
  };
  process.env.FINDASH_SNAPSHOTS_DIR = dataDir;
  const run = require('../src/scoring/run-screener.js');
  const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort();
  const snapshots = files.map(f => run.readScoringSnapshot(path.join(dataDir, f))).filter(s => s?.meta?.ticker);
  const wl = require('../lib/watchlist-fs.js').loadWatchlist(path.join(root, 'watchlist.json')); assert.equal(wl.error, null);
  const universe = run.mergeSecIntoUniverse(run.filterToAuthorizedUniverse(snapshots, wl.stocks).filtered);
  const score = require('../src/scoring/score.js'), writer = require('./write-findash-export.js'), r40 = require('./write-rule40-export.js');
  const G = require('../lib/g31-recency.js');
  const prior = arm === 'before' ? null : readJSON(path.join(workDir, 'before.json'));
  const unrounded = {}, boards = {}, calibrations = {};
  const execute = () => {
    for (const [family, formulas, options] of [['hg', require('../src/scoring/formulas/index.js'), {}],
      ['quality', require('../src/scoring/formulas/quality/index.js'), { classify: require('../src/scoring/quality-route.js').qualityRoute, growthBoost: false }]]) {
      const results = score.scoreUniverse(universe, formulas, { ...options, ...(prior ? { refCalibration: prior.calibrations[family] } : {}) });
      calibrations[family] = prior?.calibrations[family] || results.calibration;
      unrounded[family] = results.map(r => [r.ticker, r.action, r.formulaId ?? null, r.track ?? null, r.score ?? null]);
      const ranked = score.produceRankings(results, { topN: 100 });
      for (const [branch, tracks] of Object.entries(ranked.full)) {
        const mapped = {};
        for (const [track, values] of Object.entries(tracks)) {
          mapped[track] = writer.vergebeRaenge(values.map((r, i) => writer.mapBoardRow(r, i, 'main')).filter(Boolean), `${family}/${branch}/${track}`, { warn: false });
          boards[`${family}/${branch}/${track}`] = mapped[track];
        }
        if (family === 'hg') virtual.set(path.join(workDir, 'virtual-v1/full', branch + '.json'), JSON.stringify(mapped));
      }
      if (family === 'hg') virtual.set(path.join(workDir, 'virtual-v1/index.json'), JSON.stringify({ schema: writer.SCHEMA,
        generated_at: clock, branches: Object.keys(ranked.full) }));
    }
    const collected = r40.sammleKandidaten({ v1Dir: path.join(workDir, 'virtual-v1'), snapshotsDir: dataDir });
    const result = r40.baueZeilen(collected.kandidaten, new Map(), prior ? { growthBounds: prior.calibrations.rule40 } : {});
    calibrations.rule40 = prior?.calibrations.rule40 ?? result.bounds;
    boards['rule40/all'] = result.rows;
  };
  if (arm === 'v1' || arm === 'v2') G.withG31Variant(arm, execute); else execute();
  const examples = Object.fromEntries(['AUGO', 'PENG', '2548.TW'].map(t => [t, G.g31Shadow(prepared.get(t))]));
  const { annualPeriodEnds, withAnnualPairRule } = require('../lib/annual-pairs.js');
  const { norm, periodEnds } = require('../src/scoring/snapshot.js');
  const overviewEvidence = {}, annualRuleEffect = { values: 0, bonuses: 0, any: 0 };
  let maxRevenueQuarters = 0;
  for (const s of universe) {
    const ticker = s.meta.ticker, annual = norm(s, 'annualGP');
    overviewEvidence[ticker] = { annualEnd: annualPeriodEnds(s, 'annualGP')[annual.findIndex(Number.isFinite)] ?? null,
      quarterEnd: periodEnds(s, 'grossProfitQ')[0] ?? null };
    maxRevenueQuarters = Math.max(maxRevenueQuarters, norm(s, 'revenueQ').length);
    const currentLeg = G.g31Shadow(s).v1;
    const strictLeg = withAnnualPairRule({ growth: true }, () => G.g31Shadow(s).v1);
    const valueChanged = currentLeg.pct !== strictLeg.pct;
    const bonusChanged = JSON.stringify(currentLeg.bonusComponents) !== JSON.stringify(strictLeg.bonusComponents);
    if (valueChanged) annualRuleEffect.values++;
    if (bonusChanged) annualRuleEffect.bonuses++;
    if (valueChanged || bonusChanged) annualRuleEffect.any++;
  }
  const taiwanEvidence = context.stores.tw?.companies?.['2548.TW'] ?? context.stores.tw?.companies?.['2548'] ?? null;
  for (const [file, beforeHash] of inputs) assert.equal(hash(originalRead(file)), beforeHash, 'Input changed: ' + file);
  for (const evidence of Object.values(sourceManifest)) assert.equal(hash(originalRead(evidence.path)), evidence.sha256, 'Source changed during measurement');
  const inputList = [...inputs].sort(([a], [b]) => a.localeCompare(b));
  const result = { arm, clock, snapshotCount: snapshots.length, universeCount: universe.length,
    sourceManifest,
    inputDigest: hash(JSON.stringify(inputList)), calibrationDigest: hash(JSON.stringify(calibrations)),
    calibrations, unrounded, boards, examples, taiwanEvidence, overviewEvidence, annualRuleEffect, maxRevenueQuarters };
  writeJSON(path.join(workDir, arm + '.json'), result);
  writeJSON(path.join(workDir, arm + '-inputs.json'), inputList);
  console.log(JSON.stringify({ arm, rows: Object.values(boards).reduce((n, r) => n + r.length, 0), inputDigest: result.inputDigest, calibrationDigest: result.calibrationDigest }));
}

if (arm === 'report') report(); else measure();
