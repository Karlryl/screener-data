#!/usr/bin/env node
'use strict';

// Offline P115 measurement. Only --out is writable; production stays rule-off.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadUniverse, filterToAuthorizedUniverse } = require('../src/scoring/run-screener.js');
const { scoreUniverse, produceRankings, issuerDedupGroups, issuerDedupComparator, quantile } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { norm, annualPeriodEnds, _tagesnummer } = require('../src/scoring/snapshot.js');
const { withAnnualPairRule, annualPairsShadow, checkAnnualPair, checkAnnualAcceleration,
  nextDistinctAnnualIndex, ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS } = require('../src/scoring/annual-pairs.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { writeReportArtifact } = require('./f4-quartalsvergleich.js');

const ROOT = path.resolve(__dirname, '..');
const AXES = ['growth', 'grossProfit', 'acceleration'];
const FAILING = new Set(['missing-year', 'long-period', 'short-period', 'short-prior-period', 'long-prior-period', 'zero-year']);
const OUTPUTS = ['bericht.md', 'zahlen.json', 'sprung-und-top20.csv', 'paar-codes.csv', 'abstaende.csv'];
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = (xs) => [...new Set(xs)].sort(cmp);
const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
const rounded = (x) => x === null ? null : Math.round(x * 1000) / 1000;

/**
 * Maps every loaded ticker to the production issuer group, with unnamed singletons.
 * @param {object[]} snapshots Loaded snapshots before scoring deletes references.
 * @returns {Map<string,object>} Ticker to stable firm ID and readable firm name.
 */
function buildFirmMap(snapshots) {
  const entries = snapshots.map(snapshot => ({ ticker: snapshot.meta.ticker, snapshot }));
  const map = new Map();
  for (const group of issuerDedupGroups(entries)) {
    const representative = group.slice().sort(issuerDedupComparator)[0];
    const firm = { id: 'issuer:' + unique(group.map(e => e.ticker))[0],
      name: representative.snapshot.meta.name || representative.ticker };
    for (const e of group) map.set(e.ticker, firm);
  }
  for (const e of entries) if (!map.has(e.ticker)) map.set(e.ticker, { id: 'ticker:' + e.ticker, name: e.ticker });
  return map;
}

function firmOf(ticker, firms) {
  if (!firms.has(ticker)) throw new Error('Ticker ohne Emittentenzuordnung: ' + ticker);
  return firms.get(ticker);
}

/**
 * Counts distinct tickers and production issuer groups, never board occurrences.
 * @param {string[]} tickers Selected ticker population.
 * @param {Map<string,object>} firms Production issuer map.
 * @returns {{firms:number,tickers:number}} Counts at both requested levels.
 */
function countEntities(tickers, firms) {
  return { firms: new Set(tickers.map(t => firmOf(t, firms).id)).size, tickers: new Set(tickers).size };
}

/**
 * Compares positional ranks on full boards; absent ranks are not numeric jumps.
 * @param {object[]} before Ranked rows before the rule part.
 * @param {object[]} after Ranked rows after the rule part.
 * @param {Map<string,object>} firms Production issuer map.
 * @returns {object} Counts, full rank changes, membership changes and top-hundred jumps.
 */
function compareBoard(before, after, firms) {
  const oldRanks = new Map(before.map((r, i) => [r.ticker, i + 1]));
  const newRanks = new Map(after.map((r, i) => [r.ticker, i + 1]));
  if (oldRanks.size !== before.length || newRanks.size !== after.length) throw new Error('Doppelter Ticker auf einem Board');
  const rows = unique([...oldRanks.keys(), ...newRanks.keys()]).map(ticker => ({ ticker,
    firm: firmOf(ticker, firms).id, firmName: firmOf(ticker, firms).name,
    before: oldRanks.get(ticker) ?? null, after: newRanks.get(ticker) ?? null }));
  const changed = rows.filter(r => r.before !== null && r.after !== null && r.before !== r.after);
  const jumps = changed.filter(r => Math.abs(r.before - r.after) >= 5 && Math.min(r.before, r.after) <= 100);
  const lost = rows.filter(r => r.before !== null && r.after === null);
  const gained = rows.filter(r => r.before === null && r.after !== null);
  const topBefore = before.slice(0, 20).map(r => r.ticker), topAfter = after.slice(0, 20).map(r => r.ticker);
  const topIn = rows.filter(r => topAfter.includes(r.ticker) && !topBefore.includes(r.ticker));
  const topOut = rows.filter(r => topBefore.includes(r.ticker) && !topAfter.includes(r.ticker));
  const firmBefore = unique(topBefore.map(t => firmOf(t, firms).id));
  const firmAfter = unique(topAfter.map(t => firmOf(t, firms).id));
  const firmsIn = firmAfter.filter(f => !firmBefore.includes(f));
  const firmsOut = firmBefore.filter(f => !firmAfter.includes(f));
  const counts = { before: countEntities([...oldRanks.keys()], firms), after: countEntities([...newRanks.keys()], firms) };
  for (const [key, list] of Object.entries({ changed, jumps, lost, gained })) counts[key] = countEntities(list.map(r => r.ticker), firms);
  // An issuer swapping its listing is a ticker change, not a new top-20 firm.
  counts.topIn = { firms: firmsIn.length, tickers: topIn.length };
  counts.topOut = { firms: firmsOut.length, tickers: topOut.length };
  const distances = changed.map(r => Math.abs(r.before - r.after));
  return { counts, medianChange: rounded(quantile(distances, 0.5)), p90Change: rounded(quantile(distances, 0.9)),
    changed, jumps, lost, gained, topIn, topOut, firmsIn, firmsOut };
}

/**
 * Reads dated consecutive present values, retaining zero and negative reported values.
 * @param {object} snapshot Snapshot in the engine's annual representation.
 * @param {string} field annualRev or annualGP.
 * @param {boolean} collapseDuplicates Whether to collapse duplicates for the gapless counter-check only.
 * @returns {object[]} Dated pairs with original indices and the production date verdict.
 */
function datedPairs(snapshot, field, collapseDuplicates = false) {
  const values = norm(snapshot, field), ends = annualPeriodEnds(snapshot, field);
  const present = [];
  for (let i = 0; i < values.length; i = collapseDuplicates ? nextDistinctAnnualIndex(values, ends, i) : i + 1) {
    if (values[i] !== null) present.push(i);
  }
  return present.slice(1).flatMap((iOld, k) => {
    const iNew = present[k];
    if (_tagesnummer(ends[iNew]) === null || _tagesnummer(ends[iOld]) === null) return [];
    return [{ field, iNew, iOld, newer: ends[iNew], older: ends[iOld], newValue: values[iNew], oldValue: values[iOld],
      ...checkAnnualPair(snapshot, field, iNew, iOld) }];
  });
}

/**
 * Tests the measured dated distances, requiring at least one observed pair.
 * @param {object[]} pairs Consecutive dated pairs from datedPairs.
 * @returns {boolean} All observed distances lie inside the inclusive annual window.
 */
function isGapless(pairs) {
  return pairs.length > 0 && pairs.every(p => p.distanceDays >= ANNUAL_PAIR_MIN_DAYS && p.distanceDays <= ANNUAL_PAIR_MAX_DAYS);
}

/**
 * Separates date-window failures on gapless series from intentional zero-year emptying.
 * @param {object} snapshot Loaded snapshot, with zero distinguished from missing data.
 * @param {object} shadow The production annualPairsShadow result, not rebuilt verdicts.
 * @returns {object} Tested fields, failure/zero-only series and collapsed duplicate entries.
 */
function counterCheck(snapshot, shadow) {
  const checked = [], falseFailures = [], zeroOnly = [], duplicateEntriesCollapsed = [];
  for (const [field, axes] of [['annualRev', ['growth', 'acceleration']], ['annualGP', ['grossProfit']]]) {
    const values = norm(snapshot, field), ends = annualPeriodEnds(snapshot, field);
    for (let i = 0; i < values.length;) {
      const next = nextDistinctAnnualIndex(values, ends, i);
      for (let j = i + 1; j < next; j++) duplicateEntriesCollapsed.push({
        ticker: snapshot.meta.ticker, field, newer: ends[i], older: ends[j], value: values[i],
      });
      i = next;
    }
    const pairs = datedPairs(snapshot, field, true);
    if (!isGapless(pairs)) continue;
    const failures = axes.filter(axis => FAILING.has(shadow[axis].code)).map(axis => ({ axis, ...shadow[axis] }));
    const row = { ticker: snapshot.meta.ticker, field, failures };
    checked.push(row);
    const intentionalDuplicate = p => {
      if (p.code !== 'short-period' || (p.axis === 'growth'
        && withAnnualPairRule({ growth: false }, () => revGrowthLeg(snapshot).basis) === 'yearNewerRecord')) return false;
      const pair = p.axis === 'acceleration' ? checkAnnualAcceleration(snapshot) : { iNew: 0, iOld: 1 };
      return pair.iOld < nextDistinctAnnualIndex(values, ends, pair.iNew);
    };
    if (failures.some(p => p.code !== 'zero-year' && !intentionalDuplicate(p))) falseFailures.push(row);
    else if (failures.every(p => p.code === 'zero-year') && failures.some(p => Number.isFinite(p.today) && p.shadow === null)) zeroOnly.push(row);
  }
  return { checked, falseFailures, zeroOnly, duplicateEntriesCollapsed };
}

function snapshotRows(snapshots, firms, bounds) {
  return withAnnualPairRule({ growth: false, acceleration: false }, () => snapshots.map(s => ({
    ticker: s.meta.ticker, firm: firmOf(s.meta.ticker, firms).id, firmName: firmOf(s.meta.ticker, firms).name,
    basis: revGrowthLeg(s).basis, annualPairsShadow: annualPairsShadow(s, bounds),
    zeroValue: (() => { const p = checkAnnualAcceleration(s); return p.code === 'zero-year' ? norm(s, 'annualRev')[p.zeroIndex] : null; })(),
  })).sort((a, b) => cmp(a.ticker, b.ticker)));
}

function populations(rows, firms) {
  const groups = { all: [], growthYear: [], growthOther: [], grossProfit: [], partA: [], partB: [], yearAndAcceleration: [], union: [], genuineZero: [], negativeYear: [] };
  for (const r of rows) {
    const s = r.annualPairsShadow, a = FAILING.has(s.growth.code), gp = FAILING.has(s.grossProfit.code), b = FAILING.has(s.acceleration.code);
    groups.all.push(r.ticker);
    if (a) groups[r.basis === 'year' ? 'growthYear' : 'growthOther'].push(r.ticker);
    if (gp) groups.grossProfit.push(r.ticker);
    if (a || gp) groups.partA.push(r.ticker);
    if (b) groups.partB.push(r.ticker);
    if ((a && r.basis === 'year') || b) groups.yearAndAcceleration.push(r.ticker);
    if (a || gp || b) groups.union.push(r.ticker);
    if (s.acceleration.code === 'zero-year' && r.zeroValue === 0) groups.genuineZero.push(r.ticker);
    if (s.acceleration.code === 'zero-year' && r.zeroValue < 0) groups.negativeYear.push(r.ticker);
  }
  return Object.fromEntries(Object.entries(groups).map(([k, tickers]) => [k, { ...countEntities(tickers, firms), members: unique(tickers) }]));
}

function boardMap(ranked) {
  const boards = new Map();
  for (const id of Object.keys(ranked.full).sort(cmp)) for (const track of Object.keys(ranked.full[id]).sort(cmp)) {
    boards.set(id + '|' + track, ranked.full[id][track]);
  }
  boards.set('UEBERSICHT', ranked.overview);
  return boards;
}

function table(headers, rows) {
  const cell = x => String(x ?? 'leer').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  return ['| ' + headers.map(cell).join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map(r => '| ' + r.map(cell).join(' | ') + ' |')].join('\n');
}

function csv(headers, rows) {
  const cell = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  return [headers, ...rows].map(r => r.map(cell).join(',')).join('\n');
}

function report(data) {
  const { meta, comparisons, codes, reference, counter, distribution } = data;
  const c = x => `${x.firms} Firmen / ${x.tickers} Ticker`;
  const total = comparisons.filter(r => r.comparison === 'gesamt');
  const overview = total.find(r => r.board === 'UEBERSICHT');
  const lines = [
    `**Die Jahresprüfung verändert in dieser ${meta.limited ? 'Stichprobe' : 'Messung'} die Übersicht bei ${c(overview.counts.changed)} im Rang und entfernt dort ${c(overview.counts.lost)} aus der Rangliste (Tabelle B); der Gegencheck findet ${c(counter.falseFailures.counts)} mit fälschlich beanstandeten lückenlosen Reihen (Tabelle E).**`,
    '', '> **Auf einen Blick**', '>',
    `> Gemessen werden ${c(meta.loaded)} aus unveränderten Snapshot-Dateien (Tabelle A).`,
    '> Teil (a), Teil (b) und ihre Gesamtwirkung stehen getrennt in Tabelle B. Firmenwechsel und Wechsel einer Börsennotierung sind getrennt gezählt.',
    '> Die Produktionsregel bleibt ausgeschaltet. Dieser Bericht misst mögliche Änderungen und erteilt keine Freigabe.', '',
    '## Tabelle A. Festgehaltene Eingaben', '',
    table(['Merkmal', 'Wert'], Object.entries({ Snapshotquelle: meta.source, Dateien: meta.files, Auswahl: meta.limited ? 'Alphabetische Stichprobe, nicht repräsentativ' : 'Vollständiger Baum',
      'Geladene Firmen': meta.loaded.firms, 'Geladene Ticker': meta.loaded.tickers, 'Rohdatenfirmen': meta.raw.firms, 'Rohdatenticker': meta.raw.tickers,
      'Dateien ohne meta.ticker': meta.noMeta, 'Unlesbare JSON-Dateien': meta.parseFailures, 'Watchlist': meta.watchlist,
      'Kalibrierung': meta.calibrationPath || 'Live wie run(): dieselben leeren Optionen {} in allen Varianten',
      'Optionen': meta.calibrationPath ? '{refCalibration}, einmal gelesen und unverändert wiederverwendet wie run()' : '{} wie run() ohne SCORING_REF_CALIB',
      'SHA256 Snapshotinhalt': meta.snapshotHash, 'SHA256 Watchlist': meta.watchlistHash, 'SHA256 Kalibrierungsdatei': meta.calibrationHash,
      'SHA256 geladener Inhalt': meta.loadedHash, 'Gleichheitsprüfung aller Eingaben': 'Bestanden vor jedem Lauf und vor der Ausgabe',
      'Jahresfenster in Tagen': `${ANNUAL_PAIR_MIN_DAYS} bis ${ANNUAL_PAIR_MAX_DAYS}`, 'Übersicht maximal': 200, 'Top-Liste': 20, 'Sprung ab Plätzen': 5,
    })), '',
    'Der Produktionslader ergänzt Handtabellen und SEC-Daten und filtert mit derselben Watchlist. Er lädt für jede Variante frisch aus einer identischen Kopie unter `--out/eingang`, weil er dort seine interne Zähldatei schreibt. Die Quelldateien bleiben unverändert. Die Quelldateiliste und Code-Prüfsummen stehen in `zahlen.json` unter `meta`.',
    'V0 schaltet beide Regelteile aus. VA aktiviert Wachstum und Bruttogewinn. VAB aktiviert zusätzlich Beschleunigung. Die Optionen entsprechen dem gelesenen Aufruf in `run-screener.run()`, ohne dessen Ausgaben auszuführen. Bei Live-Kalibrierung lernt die Engine je Variante neu; daraus entstehende Perzentilverschiebungen gehören zum gemessenen Regeleffekt. Es wird kein abweichendes eingefrorenes Lineal erfunden.',
    'Die Übersicht ist die begrenzte Produktionsübersicht gemäß Tabelle A. Ein dort verlorener Rang kann daher einen Austritt aus der Übersicht bedeuten. Die Branchenboards stammen aus `full` und sind unbegrenzt. Nicht vorhandene Ränge bleiben leer und gelten nicht als numerischer Sprung.', '',
    '## Tabelle B. Ränge und Zusammensetzung', '',
    'Jede Zählzelle nennt Firmen / Ticker. Geänderte Ränge betreffen gemeinsame Zeilen; verlorene und gewonnene Ränge stehen separat. Bei den Spitzenplätzen zählen die Firmen echte Eintritte beziehungsweise Austritte der Emittentengruppe. Die übrigen Firmenzahlen zählen die verschiedenen Emittenten der jeweiligen betroffenen Zeilen. Boards werden nicht addiert.', '',
    table(['Vergleich', 'Board', 'Vorher', 'Nachher', 'Rang geändert', 'Spitzengruppe hinein', 'Spitzengruppe hinaus', 'Sprünge', 'Rang verloren', 'Rang gewonnen', 'Median Betrag', 'p90 Betrag'],
      comparisons.map(r => [r.comparison, r.board, ...['before', 'after', 'changed', 'topIn', 'topOut', 'jumps', 'lost', 'gained'].map(k => c(r.counts[k])), r.medianChange, r.p90Change])), '',
    'Alle betroffenen Zeilen mit Rang vorher, Rang nachher, Firma und Achsencodes stehen in `sprung-und-top20.csv`; die vollständigen Änderungen einschließlich kleiner Verschiebungen stehen in `zahlen.json` unter `comparisons`. Die Codes erklären den eigenen Jahresvergleich. Rangänderungen können zusätzlich durch die veränderte Vergleichsgruppe entstehen.', '',
    '## Tabelle C. Paarcodes je Achse', '',
    table(['Achse', 'Code', 'Firmen', 'Ticker'], codes.map(r => [r.axis, r.code, r.firms, r.tickers])), '',
    'Jeder Code stammt unmittelbar aus `annualPairsShadow`. Die Vereinigung der Fehler zählt jeden Emittenten und Ticker nur einmal (Tabelle D, Zeile union). `no-annual-pair` und `undated` gelten nicht als Fehler. Mehrere Achsen und Codes dürfen dieselbe Firma enthalten und sind daher nicht addierbar. Die Einzelbelege mit Gründen und Werten stehen in `paar-codes.csv`.', '',
    '## Tabelle D. Abgleich mit der Vormessung P115-M', '',
    table(['Population', 'Referenz Firmen / Ticker', 'Rohdaten', 'Rohdaten nach Watchlist', 'Produktionslader', 'Abweichung zur Referenz Firmen / Ticker'],
      reference.rows.map(r => [r.key, `${r.expected.firms ?? 'nicht angegeben'} / ${r.expected.tickers ?? 'nicht angegeben'}`, c(r.raw), c(r.authorized), c(r.loaded), `${r.delta.firms ?? 'nicht prüfbar'} / ${r.delta.tickers ?? 'nicht prüfbar'}`])), '',
    'Die Referenzen in Tabelle D stammen aus dem Auftrag zu P115-M. `growthYear` zählt Fehler im Umsatzwachstum nur bei Anzeigegrundlage `year`; `growthOther` ergänzt andere Anzeigegrundlagen einschließlich `quarter` und `yearNewerRecord`. `partA` vereinigt alle Wachstumsfehler mit `grossProfit`, `partB` zählt die Beschleunigungsfehler. `yearAndAcceleration` vereinigt den engen Anzeigeumfang mit Beschleunigung, `union` dagegen alle Achsen. `genuineZero` zählt den vom Produktionsprüfer bezeichneten übersprungenen Wert genau gleich null; negative gemeldete Werte stehen separat als `negativeYear`.',
    'Jeder Schritt ist mit den tatsächlichen Tickerlisten in `zahlen.json` unter `reference.stages` nachvollziehbar. Die Differenz zwischen Rohdaten und gefilterten Rohdaten kommt vom Watchlist-Schnitt und der dazugehörigen Neugruppierung der Emittenten. Die Differenz zum Produktionslader kommt aus dessen Handtabellen und SEC-Ergänzung. Die zusätzlichen Regelumfänge sind mit getrennten Zeilen statt einer pauschalen Hochrechnung belegt.',
    ...reference.notes, '',
    '### Tabelle D2. Rechnerische Zerlegung der Abweichungen', '',
    'Die vorzeichenbehafteten Differenzen nennen Firmen / Ticker. Für die Vereinigung beginnt die Brücke bei `yearAndAcceleration` und ergänzt anschließend die weiteren Anzeigegrundlagen und Bruttogewinn. Der nicht belegbare Rest zur Vormessung bleibt ausdrücklich offen. Alle Zwischenschritte stehen mit Tickerlisten in `zahlen.json`.', '',
    table(['Referenzpopulation', 'Rest zwischen Referenz und Rohdaten', 'Watchlist und Neugruppierung', 'Handtabellen und SEC-Ergänzung', 'Erweiterter Achsenumfang', 'Gesamtabweichung'],
      reference.bridges.map(r => [r.key, ...['residual', 'watchlist', 'loader', 'scope', 'total'].map(k => `${r[k].firms ?? 'nicht prüfbar'} / ${r[k].tickers ?? 'nicht prüfbar'}`)])), '',
    '## Tabelle E. Gegencheck lückenloser Reihen', '',
    table(['Prüfung', 'Reihen', 'Firmen', 'Ticker'], ['checked', 'falseFailures', 'zeroOnly'].map(k => [
      { checked: 'Lückenlose datierte Reihen', falseFailures: 'Fälschlich beanstandete lückenlose Reihen, Soll null', zeroOnly: 'Nur wegen zero-year geleert' }[k],
      counter[k].rows.length, counter[k].counts.firms, counter[k].counts.tickers])), '',
    'Vorhandene Werte umfassen echte Nullen und negative Zahlen. Für diesen Gegencheck werden zunächst unmittelbar folgende Doppel-Einträge mit exakt gleichem endlichem normalisiertem Wert und weniger als 334 Tagen Abstand zum beibehaltenen Ende zusammengefasst (Tabelle E2). Fehlwerte werden übersprungen; nur direkt aufeinanderfolgende vorhandene Werte mit zwei gültigen Enddaten bilden ein datiertes Paar. Mindestens ein solches Paar muss vorhanden sein, und alle beobachteten Abstände müssen im Fenster aus Tabelle A liegen. Undatierte Paare beweisen weder eine Lücke noch Lückenlosigkeit. Der Gegencheck zählt bereits jeden Fehlercode außer `zero-year` und berechtigt verworfenen Doppel-Einträgen im ausgewählten Vergleichspaar, auch wenn die Anzeige dank eines anderen Beins erhalten bleibt; alle verworfenen Vergleiche bleiben unter `counter.checked.rows` belegt.', '',
    table(['Ticker', 'Firma', 'Reihe', 'Art', 'Achse und Grund'], ['falseFailures', 'zeroOnly'].flatMap(k => counter[k].rows.map(r => [r.ticker, r.firmName, r.field,
      k === 'falseFailures' ? 'Gegencheck verletzt' : 'Begründete Nulljahr-Leerung', r.failures.map(p => `${p.axis}: ${p.code}. ${p.reason}`).join(' ')]))), '',
    '### Tabelle E2. Zusammengefasste Doppel-Einträge', '',
    'Die Liste steht in `zahlen.json` unter `counter.duplicateEntriesCollapsed.rows`; die ursprünglichen Abstände in Tabelle F bleiben erhalten.', '',
    table(['Ticker', 'Reihe', 'Beibehaltenes Ende', 'Doppeltes Ende', 'Wert'],
      counter.duplicateEntriesCollapsed.rows.map(r => [r.ticker, r.field, r.newer, r.older, r.value])), '',
    '## Tabelle F. Verteilung der Jahresendabstände', '',
    'Die Verteilung umfasst alle datierten aufeinanderfolgenden vorhandenen Umsatzwerte des Produktionsladers. Die Zahl der Paare zählt Beobachtungen; Firmen und Ticker sind je Abstand dedupliziert. `abstaende.csv` enthält zusätzlich die Bruttogewinnpaare. Der Rohdatenvergleich steht in `zahlen.json` unter `distribution.raw`.', '',
    table(['Abstand Tage', 'Paare', 'Firmen', 'Ticker'], distribution.loaded.histogram.map(r => [r.days, r.pairs, r.firms, r.tickers])), '',
    table(['Population', 'Paare', 'Firmen', 'Ticker', 'Minimum', 'Median', 'p90', 'p99', 'Maximum'], ['raw', 'loaded'].map(k => {
      const s = distribution[k]; return [k, s.pairs, s.firms, s.tickers, s.min, s.median, s.p90, s.p99, s.max];
    })), '',
    '## Tabelle G. Paare unmittelbar neben dem Fenster', '',
    'Diese Tabelle nennt sämtliche gemessenen Paare von 300 bis 333 oder von 398 bis 455 Tagen. Neben den aufeinanderfolgenden Umsatz- und Bruttogewinnwerten stehen ausgewählte Achsenpaare und deren geprüfte Vorjahresabstände dabei; derselbe Abstand kann dadurch mehrere Belegzeilen haben. Die Codes werden aus dem jeweiligen Produktionsprüfer übernommen.', '',
    table(['Ticker', 'Firma', 'Quelle', 'Neueres Ende', 'Älteres Ende', 'Tage', 'Code'], data.nearWindow.map(r => [r.ticker, r.firmName, r.source, r.newer, r.older, r.distanceDays, r.code])), '',
  ];
  return lines.join('\n');
}

function distanceDistribution(rows, firms) {
  const revenue = rows.filter(r => r.field === 'annualRev');
  const days = revenue.map(r => r.distanceDays);
  return { pairs: revenue.length, ...countEntities(revenue.map(r => r.ticker), firms),
    min: rounded(quantile(days, 0)), median: rounded(quantile(days, 0.5)), p90: rounded(quantile(days, 0.9)), p99: rounded(quantile(days, 0.99)), max: rounded(quantile(days, 1)),
    histogram: [...new Set(days)].sort((a, b) => a - b).map(day => {
      const selected = revenue.filter(r => r.distanceDays === day);
      return { days: day, pairs: selected.length, ...countEntities(selected.map(r => r.ticker), firms) };
    }) };
}

function allDistances(snapshots, firms) {
  return snapshots.flatMap(s => ['annualRev', 'annualGP'].flatMap(field => datedPairs(s, field).map(pair => ({
    ticker: s.meta.ticker, firm: firmOf(s.meta.ticker, firms).id, firmName: firmOf(s.meta.ticker, firms).name, ...pair,
  }))));
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

// Resolve existing ancestors too, so a symlink/junction cannot bypass output isolation.
function realTarget(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(realTarget(path.dirname(file)), path.basename(file));
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--snapshots', '--out', '--limit'].includes(key) || !argv[i + 1] || args[key] !== undefined) throw new Error('Ungültige oder doppelte Option: ' + key);
    args[key] = argv[i + 1];
  }
  if (!args['--snapshots'] || !args['--out']) throw new Error('Aufruf: node scripts/p115-jahrespaare-vorher-nachher.js --snapshots <dir> --out <dir> [--limit <n>]');
  const limit = args['--limit'] === undefined ? Infinity : Number(args['--limit']);
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error('--limit muss eine positive ganze Zahl sein');
  if (args['--limit'] !== undefined && !/^\d+$/.test(args['--limit'])) throw new Error('--limit muss eine positive ganze Zahl sein');
  const source = fs.realpathSync(path.resolve(args['--snapshots'])), out = realTarget(path.resolve(args['--out']));
  const repo = fs.realpathSync(ROOT);
  if ([source, repo].some(p => isInside(p, out) || isInside(out, p))) throw new Error('--out muss außerhalb von Repository und Snapshotquelle liegen und darf sie nicht enthalten');
  if (!fs.statSync(source).isDirectory()) throw new Error('--snapshots ist kein Verzeichnis');
  if (fs.existsSync(out) && (!fs.statSync(out).isDirectory() || fs.readdirSync(out).length)) throw new Error('--out muss neu oder leer sein; vorhandene Messungen werden nicht überschrieben');
  const entries = fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => cmp(a.name, b.name));
  if (entries.some(e => e.isDirectory() || e.isSymbolicLink())) throw new Error('Wie loadUniverse wird ein flacher Snapshotordner ohne Verknüpfungen erwartet');
  const names = entries.filter(e => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_manifest') && e.name !== '_last_good_disk.json').map(e => e.name).slice(0, limit);
  if (!names.length) throw new Error('Keine Snapshotdateien ausgewählt');
  const started = process.hrtime.bigint();
  const watchlist = path.join(ROOT, 'watchlist.json'), wl = loadWatchlist(watchlist);
  if (wl.error) throw new Error('Watchlist nicht ladbar: ' + wl.error);
  const refPath = process.env.SCORING_REF_CALIB ? fs.realpathSync(path.resolve(process.env.SCORING_REF_CALIB)) : null;
  const refText = refPath ? fs.readFileSync(refPath, 'utf8') : null;
  const refCalibration = refText ? JSON.parse(refText) : null;
  const sameOpts = refCalibration ? { refCalibration } : {};
  const optsHash = hash(JSON.stringify(sameOpts));
  const watchlistHash = hash(fs.readFileSync(watchlist));
  fs.mkdirSync(out, { recursive: true });
  const input = path.join(out, 'eingang');
  fs.mkdirSync(input);
  const raw = [], sourceFiles = [];
  let parseFailures = 0, noMeta = 0;
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(source, name));
    sourceFiles.push({ name, sha256: hash(bytes) });
    fs.writeFileSync(path.join(input, name), bytes, { flag: 'wx' });
    let s;
    try { s = JSON.parse(bytes.toString('utf8')); } catch (_) { parseFailures++; continue; }
    if (!s?.meta?.ticker) { noMeta++; continue; }
    raw.push(s);
  }
  const verifyInputs = () => {
    if (hash(fs.readFileSync(watchlist)) !== watchlistHash || (refPath && hash(fs.readFileSync(refPath)) !== hash(refText)) || hash(JSON.stringify(sameOpts)) !== optsHash) throw new Error('Watchlist oder Kalibrierung hat sich während der Messung geändert');
    for (const f of sourceFiles) if (hash(fs.readFileSync(path.join(source, f.name))) !== f.sha256 || hash(fs.readFileSync(path.join(input, f.name))) !== f.sha256) throw new Error('Snapshotinhalt hat sich geändert: ' + f.name);
  };
  const ranked = {}, variants = [['V0', false, false], ['VA', true, false], ['VAB', true, true]];
  let prepared, firms, loadedHash, bounds;
  for (const [id, growth, acceleration] of variants) {
    verifyInputs();
    console.log('P115: ' + id + ' lädt und rechnet frisch.');
    withAnnualPairRule({ growth, acceleration }, () => {
      const universe = loadUniverse(input);
      const digest = hash(JSON.stringify(universe));
      if (id === 'V0') { loadedHash = digest; prepared = structuredClone(universe); firms = buildFirmMap(universe); }
      else if (digest !== loadedHash) throw new Error('Produktionslader liefert abweichende Eingaben für ' + id);
      if (new Set(universe.map(s => s.meta.ticker)).size !== universe.length) throw new Error('Doppelte Ticker im geladenen Universum');
      const results = scoreUniverse(universe, formulas, sameOpts);
      if (id === 'V0') bounds = results.calibration?.winsorBounds?.qoq ?? null;
      ranked[id] = boardMap(produceRankings(results, { topN: 100 }));
    });
  }
  verifyInputs();
  const rows = snapshotRows(prepared, firms, bounds), byTicker = new Map(rows.map(r => [r.ticker, r]));
  const comparisons = [], events = [];
  for (const [comparison, before, after] of [['a', 'V0', 'VA'], ['b', 'VA', 'VAB'], ['gesamt', 'V0', 'VAB']]) {
    for (const board of unique([...ranked[before].keys(), ...ranked[after].keys()])) {
      const result = compareBoard(ranked[before].get(board) || [], ranked[after].get(board) || [], firms);
      for (const kind of ['changed', 'jumps', 'lost', 'gained', 'topIn', 'topOut']) {
        result[kind] = result[kind].map(r => ({ ...r, annualPairsShadow: byTicker.get(r.ticker).annualPairsShadow }));
        if (kind !== 'changed') for (const r of result[kind]) events.push({ comparison, board, kind, ...r,
          firmMembershipChanged: kind === 'topIn' ? result.firmsIn.includes(r.firm) : kind === 'topOut' ? result.firmsOut.includes(r.firm) : null });
      }
      comparisons.push({ comparison, board, ...result });
    }
  }
  const codes = AXES.flatMap(axis => unique(rows.map(r => r.annualPairsShadow[axis].code)).map(code => ({ axis, code,
    ...countEntities(rows.filter(r => r.annualPairsShadow[axis].code === code).map(r => r.ticker), firms) })));
  const rawFirms = buildFirmMap(raw), authorized = filterToAuthorizedUniverse(raw, wl.stocks).filtered, authorizedFirms = buildFirmMap(authorized);
  const rawRows = snapshotRows(raw, rawFirms, bounds), authorizedRows = rawRows.filter(r => authorizedFirms.has(r.ticker));
  const stages = { raw: populations(rawRows, rawFirms), authorized: populations(authorizedRows, authorizedFirms), loaded: populations(rows, firms) };
  const expectations = { union: { firms: 96, tickers: 130 }, growthYear: { firms: 19, tickers: 20 }, partB: { firms: 95, tickers: 129 }, genuineZero: { firms: 43, tickers: null } };
  const reference = { stages, rows: Object.keys(stages.loaded).map(key => {
    const expected = expectations[key] || { firms: null, tickers: null };
    return { key, expected, raw: stages.raw[key], authorized: stages.authorized[key], loaded: stages.loaded[key],
      delta: Object.fromEntries(['firms', 'tickers'].map(k => [k, expected[k] === null ? null : stages.loaded[key][k] - expected[k]])) };
  }), notes: [] };
  const difference = (after, before) => Object.fromEntries(['firms', 'tickers'].map(k => [k,
    before[k] === null || after[k] === null ? null : after[k] - before[k]]));
  reference.bridges = Object.entries(expectations).map(([key, expected]) => {
    const comparable = key === 'union' ? 'yearAndAcceleration' : key;
    return { key, residual: difference(stages.raw[comparable], expected),
      watchlist: difference(stages.authorized[comparable], stages.raw[comparable]),
      loader: difference(stages.loaded[comparable], stages.authorized[comparable]),
      scope: difference(stages.loaded[key], stages.loaded[comparable]), total: difference(stages.loaded[key], expected) };
  });
  if (Number.isFinite(limit)) reference.notes.push('Die alphabetische Stichprobe ist eine andere Population als die vollständige Vormessung. Ihre Abweichungen sind keine Widerlegung der Referenzzahlen (Auswahl in Tabelle A).');
  const residual = reference.bridges.filter(r => ['firms', 'tickers'].some(k => r.residual[k] !== null && r.residual[k] !== 0));
  if (!Number.isFinite(limit) && residual.length) reference.notes.push('Offen bleibt die Differenz bereits auf Rohdatenebene für ' + residual.map(r => r.key).join(', ') + '. Der Auftrag enthält keine Einzelbelege oder ausführbare Zählregel von P115-M. Diese Restabweichung lässt sich damit keiner weiteren Ursache sicher zuordnen; sie wird nicht als Handtabelleneffekt ausgegeben.');
  reference.notes.push('Die Referenz für Teil (a) wird mit `growthYear` verglichen. Ob P115-M darüber hinaus Bruttogewinnfehler mitzählte, geht aus dem Auftrag nicht eindeutig hervor; deshalb stehen `grossProfit` und der vollständige Teil (a) separat in Tabelle D.');
  const counter = {};
  const checks = prepared.map(s => counterCheck(s, byTicker.get(s.meta.ticker).annualPairsShadow));
  for (const key of ['checked', 'falseFailures', 'zeroOnly', 'duplicateEntriesCollapsed']) {
    const list = checks.flatMap(r => r[key]).map(r => ({ ...r, firm: firmOf(r.ticker, firms).id, firmName: firmOf(r.ticker, firms).name }));
    counter[key] = { counts: countEntities(list.map(r => r.ticker), firms), rows: list };
  }
  const distances = allDistances(prepared, firms), rawDistances = allDistances(raw, rawFirms);
  const inBand = d => (d >= 300 && d <= 333) || (d >= 398 && d <= 455);
  const nearWindow = distances.filter(r => inBand(r.distanceDays)).map(r => ({ ...r, source: r.field + ':aufeinanderfolgend' }));
  for (const r of rows) for (const axis of AXES) for (const kind of ['distanceDays', 'priorLengthDays']) {
    const p = r.annualPairsShadow[axis];
    if (inBand(p[kind])) nearWindow.push({ ticker: r.ticker, firm: r.firm, firmName: r.firmName, source: axis + ':' + kind, distanceDays: p[kind], code: p.code, newer: null, older: null });
  }
  nearWindow.sort((a, b) => cmp(a.ticker, b.ticker) || cmp(a.source, b.source) || a.distanceDays - b.distanceDays);
  const data = { meta: { source, files: names.length, limited: Number.isFinite(limit), sourceFiles, snapshotHash: hash(JSON.stringify(sourceFiles)),
    watchlist, watchlistHash, calibrationPath: refPath, calibrationHash: refText ? hash(refText) : null, loadedHash,
    loaded: countEntities(rows.map(r => r.ticker), firms), raw: countEntities(rawRows.map(r => r.ticker), rawFirms), noMeta, parseFailures,
    shadowAccelerationBounds: bounds,
    codeHashes: Object.fromEntries(Object.keys(require.cache).filter(f => isInside(ROOT, f) && f.endsWith('.js')).sort(cmp).map(f => [path.relative(ROOT, f).split(path.sep).join('/'), hash(fs.readFileSync(f))])),
  }, comparisons, codes, snapshotRows: rows, reference, counter,
  distribution: { raw: distanceDistribution(rawDistances, rawFirms), loaded: distanceDistribution(distances, firms) }, nearWindow };
  verifyInputs();
  writeReportArtifact(path.join(out, 'zahlen.json'), JSON.stringify(data, null, 2));
  writeReportArtifact(path.join(out, 'sprung-und-top20.csv'), csv(['Vergleich', 'Board', 'Ereignis', 'Ticker', 'Firmen-ID', 'Firma', 'Rang vorher', 'Rang nachher', 'Firmenwechsel Spitzengruppe', ...AXES],
    events.map(r => [r.comparison, r.board, r.kind, r.ticker, r.firm, r.firmName, r.before, r.after, r.firmMembershipChanged, ...AXES.map(axis => r.annualPairsShadow[axis].code)])));
  writeReportArtifact(path.join(out, 'paar-codes.csv'), csv(['Ticker', 'Firmen-ID', 'Firma', 'Anzeigegrundlage', 'Achse', 'Code', 'Abstand Tage', 'Vorjahreslänge Tage', 'Wert vorher', 'Schattenwert', 'Grund'],
    rows.flatMap(r => AXES.map(axis => { const p = r.annualPairsShadow[axis]; return [r.ticker, r.firm, r.firmName, r.basis, axis, p.code, p.distanceDays, p.priorLengthDays, rounded(p.today), rounded(p.shadow), p.reason]; }))));
  writeReportArtifact(path.join(out, 'abstaende.csv'), csv(['Ticker', 'Firmen-ID', 'Firma', 'Reihe', 'Index neu', 'Index alt', 'Ende neu', 'Ende alt', 'Abstand Tage', 'Code'],
    distances.map(r => [r.ticker, r.firm, r.firmName, r.field, r.iNew, r.iOld, r.newer, r.older, r.distanceDays, r.code])));
  writeReportArtifact(path.join(out, 'bericht.md'), report(data));
  console.log(`P115: ${names.length} Dateien, ${data.meta.loaded.firms} Firmen / ${data.meta.loaded.tickers} Ticker; ${OUTPUTS.length} Ausgabedateien in ${out}.`);
  console.log(`P115: Gegencheck ${counter.falseFailures.rows.length}; Laufzeit ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(3)} Sekunden.`);
  if (counter.falseFailures.rows.length) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('P115 abgebrochen: ' + e.message); process.exitCode = 1; }
}
module.exports = { buildFirmMap, countEntities, compareBoard, datedPairs, isGapless, counterCheck };
