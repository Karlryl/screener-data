'use strict';

// Offline counterfactual only. No production imports, writers, FX lookup or network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { isMetadataSnapshot, safeSnapshotFilename } = require('../lib/snapshot-fs');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_POPULATION = 'C:/Users/Anwender/AppData/Local/Temp/claude/C--Users-Anwender-Market-Structure-research/754a849d-444e-4e77-98cd-1d62ad581fad/scratchpad/ci-pop-35438100627';
const OUTPUT = path.join(ROOT, 'reports/t322-ads-verhaeltnis-optionen-2026-09-20');
const OPTIONS = ['A', 'B', 'C-100', 'C-50', 'C-nur-die-7'];
// Evaluation labels from the brief, never used by A/B to select a correction.
const CORRECT = ['UEC', 'INTC', 'JBS', 'MGNI', 'WSC'];
const POSITIVE = { HSAI: 1 / 7.87, LU: 2 };
const SEVEN = [...CORRECT, ...Object.keys(POSITIVE)];
const TOLERANCE = 0.03;
const positive = x => Number.isFinite(x) && x > 0;
const isUSLine = ticker => typeof ticker === 'string' && !ticker.includes('.');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const close = (a, b) => positive(a) && positive(b) && Math.abs(a / b - 1) <= TOLERANCE;

function loadGrouping() {
  // The watcher has no exports and exits the process. Reuse ONLY its two pure
  // function declarations verbatim, without executing its imports or live scan.
  const file = path.join(ROOT, 'tests/waehrung-ausliefer-waechter.test.js');
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function emittentSchluessel(');
  const end = source.indexOf('const HKD =', start);
  if (start < 0 || end < start) throw new Error('Watcher extraction boundary changed');
  const fragment = source.slice(start, end);
  const context = { TOLERANZ: TOLERANCE };
  vm.runInNewContext(fragment, context, { timeout: 1000 });
  if (typeof context.kreuznotizVerstoesse !== 'function') throw new Error('Missing watcher grouping');
  return { group: context.kreuznotizVerstoesse, hash: digest(fragment) };
}
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function currency(s) {
  const units = [s.price?.currencyUnit, s.meta?.priceCurrency].filter(Boolean);
  if (new Set(units).size > 1) return null;
  return units[0] || s.price?.currency || null;
}
function asLeg(s) {
  const m = s.meta || {};
  return { ticker: m.ticker, name: m.name, marketCap: s.marketCap?.value,
    tradingCurrency: m.tradingCurrencyOriginal || m.tradingCurrency,
    shares: m.sharesOutstanding, price: s.price?.regularMarketPrice,
    priceCurrency: currency(s),
    // Do not infer FX from arithmetic. The stored conversion stamp is evidence
    // that marketCap is already USD, NOT a rate used for another conversion.
    capCurrency: s.marketCap?.currencyUnit || s.marketCap?.currency ||
      (positive(m.tradingFxRateApplied) ? 'USD' :
        m.tradingCurrency === 'USD' && !m.tradingCurrencyAssumed ? 'USD' : null) };
}
function readPopulation(directory) {
  const root = path.resolve(directory);
  if (root === path.join(ROOT, 'snapshots') || root.startsWith(path.join(ROOT, 'snapshots') + path.sep)) {
    throw new Error('Local snapshots/ is forbidden');
  }
  const shards = fs.readdirSync(root, { withFileTypes: true })
    .filter(x => x.isDirectory() && /^snapshots-shard-\d+$/.test(x.name)).map(x => x.name).sort(compare);
  if (shards.length !== 17) throw new Error(`Expected 17 extracted shards, got ${shards.length}`);
  const hash = crypto.createHash('sha256'), legs = [], seen = new Set();
  let snapshots = 0, delisted = 0, missing = 0;
  for (const shard of shards) {
    for (const f of fs.readdirSync(path.join(root, shard)).sort(compare)) {
      if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
      const bytes = fs.readFileSync(path.join(root, shard, f));
      hash.update(`${shard}/${f}\0`).update(bytes);
      const s = JSON.parse(bytes);
      if (!s.meta?.ticker) throw new Error(`Snapshot without ticker: ${shard}/${f}`);
      if (safeSnapshotFilename(s.meta.ticker) !== f) throw new Error(`Filename mismatch: ${f}`);
      if (seen.has(s.meta.ticker)) throw new Error(`Duplicate ticker: ${s.meta.ticker}`);
      seen.add(s.meta.ticker); snapshots++;
      if (s.meta.delisted) { delisted++; continue; }
      const leg = asLeg(s);
      if (!positive(leg.marketCap) || !positive(leg.shares)) { missing++; continue; }
      legs.push(leg);
    }
  }
  return { root, legs, snapshots, delisted, missing, hash: hash.digest('hex') };
}
function readBoards(directory = path.join(ROOT, 'board-history')) {
  const dates = fs.readdirSync(directory, { withFileTypes: true })
    .filter(x => x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name)).map(x => x.name).sort(compare);
  const vintage = dates.at(-1);
  if (!vintage) throw new Error('No board vintage');
  const ranks = new Map(), hash = crypto.createHash('sha256');
  for (const f of fs.readdirSync(path.join(directory, vintage)).sort(compare)) {
    if (!f.endsWith('.json')) continue;
    const bytes = fs.readFileSync(path.join(directory, vintage, f));
    const b = JSON.parse(bytes);
    if (!b.cohort) continue; // Content-based sidecar exclusion.
    hash.update(f + '\0').update(bytes);
    for (const [track, rows] of Object.entries(b.cohort)) {
      if (!Array.isArray(rows)) throw new Error(`Invalid cohort: ${f}`);
      for (const r of rows) {
        if (!r.ticker || !positive(r.rank)) throw new Error(`Invalid board row: ${f}`);
        if (!ranks.has(r.ticker)) ranks.set(r.ticker, []);
        ranks.get(r.ticker).push({ board: b.board, track, rank: r.rank });
      }
    }
  }
  return { vintage, ranks, hash: hash.digest('hex') };
}
function integerRatio(a, b) {
  if (!positive(a) || !positive(b)) return false;
  const q = Math.max(a, b) / Math.min(a, b);
  return close(q, Math.round(q));
}
function scan(legs, grouping = loadGrouping().group) {
  const candidates = [];
  let eligiblePairs = 0, discrepantPairs = 0, issuers = 0;
  for (const g of grouping(legs, 0)) {
    let selected = false;
    const foreign = g.beine.filter(x => !isUSLine(x.ticker)).sort((a, b) => compare(a.ticker, b.ticker));
    for (const us of g.beine.filter(x => isUSLine(x.ticker))) {
      const pairs = foreign.filter(h => integerRatio(us.shares, h.shares));
      eligiblePairs += pairs.length;
      const discrepant = pairs.filter(h => Math.max(us.marketCap, h.marketCap) / Math.min(us.marketCap, h.marketCap) > 1.5);
      discrepantPairs += discrepant.length;
      if (discrepant.length) {
        // Keep ALL foreign legs for ambiguity checks, not just the outlier.
        candidates.push({ issuer: g.emittent, us, foreign }); selected = true;
      }
    }
    if (selected) issuers++;
  }
  candidates.sort((a, b) => compare(a.us.ticker, b.us.ticker));
  return { candidates, eligiblePairs, discrepantPairs, issuers };
}
const unavailable = reason => ({ applicable: false, factor: null, reason });
function estimateA(us, home) {
  if (!integerRatio(us.shares, home.shares)) return unavailable('Verhältnis nicht eindeutig: Stückzahlen');
  const sharesFactor = home.shares / us.shares;
  if (!close(sharesFactor, 1)) {
    const factor = sharesFactor > 1 ? Math.round(sharesFactor) : 1 / Math.round(1 / sharesFactor);
    return { applicable: true, factor, reason: 'A-Hypothese: ganzzahliges Stückzahl-Verhältnis' };
  }
  if (!us.priceCurrency || us.priceCurrency !== home.priceCurrency) return unavailable('nicht entscheidbar ohne Kurs');
  if (!positive(us.price) || !positive(home.price)) return unavailable('Verhältnis nicht eindeutig: Aktienkurs fehlt');
  const priceRatio = us.price / home.price;
  const q = priceRatio >= 1 ? priceRatio : 1 / priceRatio;
  if (!close(q, Math.round(q))) return unavailable('Verhältnis nicht eindeutig: Kurs-Verhältnis nicht ganzzahlig');
  return { applicable: true, factor: priceRatio >= 1 ? 1 / Math.round(q) : Math.round(q),
    reason: 'A-Hypothese: gleiche Stückzahl; ganzzahliges Kurs-Verhältnis in gleicher Währung' };
}
function estimate(candidate, option) {
  const { us, foreign } = candidate;
  if (!foreign.length) return unavailable('keine Heimat-Linie');
  if (option === 'B') {
    // No arbitrary picking of a thin foreign line among multiple listings.
    if (foreign.length !== 1) return unavailable('Heimat-Linie nicht eindeutig: mehrere Nicht-US-Linien');
    const h = foreign[0];
    if (!us.capCurrency || us.capCurrency !== h.capCurrency) return unavailable('nicht entscheidbar ohne Kurs');
    return { applicable: true, factor: h.marketCap / us.marketCap,
      reason: 'B-Hypothese: einzige Nicht-US-Linie als Heimat-Linie (nicht bestätigt)' };
  }
  if (option !== 'A') throw new Error(`Unknown numerical option: ${option}`);
  const values = foreign.map(h => estimateA(us, h));
  const missing = values.find(v => !v.applicable);
  if (missing) return missing;
  if (values.some(v => v.factor !== values[0].factor)) return unavailable('Verhältnis nicht eindeutig: Linien widersprechen sich');
  return values[0];
}
function changed(factor) { return positive(factor) && factor !== 1; }
function assessment(ticker, result) {
  if (!result.applicable) return 'nicht entscheidbar';
  if (!changed(result.factor)) return 'unberührt';
  if (CORRECT.includes(ticker)) return 'verdirbt';
  if (Object.hasOwn(POSITIVE, ticker)) return close(result.factor, POSITIVE[ticker]) ? 'korrigiert' : 'verdirbt';
  return 'Wahrheit nicht belegt';
}
function measure(candidates, ranks) {
  // 50% is one reproducible scenario, not a random sample or an expected effect.
  const half = new Set(candidates.slice(0, Math.floor(candidates.length / 2)).map(c => c.us.ticker));
  return candidates.flatMap(c => OPTIONS.map(option => {
    const ticker = c.us.ticker;
    const covered = option === 'C-100' || option === 'C-50' && half.has(ticker) || option === 'C-nur-die-7' && SEVEN.includes(ticker);
    const result = option.startsWith('C-') ? unavailable(covered ?
      'Tabellen-Abdeckung angenommen; Verhältniswert fehlt (kein Tabellen-Eintrag vorhanden)' : 'kein Tabellen-Eintrag: außerhalb angenommener Abdeckung') : estimate(c, option);
    const boards = ranks.get(ticker) || [];
    const factor = result.factor;
    return { ticker, heimat_linie: c.foreign.map(h => h.ticker).join('|'), option,
      anwendbar: result.applicable ? 'ja' : 'nein', grund: result.reason,
      mcap_heute: c.us.marketCap, mcap_unter_option: result.applicable ? c.us.marketCap * factor : null,
      faktor: factor, richtung: factor === null ? 'nicht entscheidbar' : factor === 1 ? 'unverändert' : factor < 1 ? 'zu groß' : 'zu klein',
      im_brett: boards.length ? 'ja' : 'nein', rang_heute: boards.map(b => b.rank).join('|'),
      brett: boards.map(b => `${b.board}/${b.track}`).join('|'), einordnung: assessment(ticker, result),
      emittent: c.issuer, heimat_status: 'Nicht-US-Gegenlinien; Heimat-/Primärstatus nicht abgeleitet',
      tabellen_abdeckung_angenommen: option.startsWith('C-') ? covered ? 'ja' : 'nein' : '',
      mcap_waehrung: c.us.capCurrency || 'unbekannt' };
  }));
}
function summarize(rows) {
  return OPTIONS.map(option => {
    const group = rows.filter(r => r.option === option);
    const negatives = group.filter(r => CORRECT.includes(r.ticker));
    const controls = Object.fromEntries(Object.keys(POSITIVE).map(ticker => {
      const row = group.find(r => r.ticker === ticker);
      return [ticker, row?.einordnung === 'korrigiert' ? 'Treffer' : 'KEIN Treffer'];
    }));
    return { option, applicable: group.filter(r => r.anwendbar === 'ja').length,
      fxMissing: group.filter(r => r.grund === 'nicht entscheidbar ohne Kurs').length,
      covered: group.filter(r => r.tabellen_abdeckung_angenommen === 'ja').length,
      collateral: negatives.filter(r => r.anwendbar === 'ja' && changed(r.faktor)).length,
      collateralUnknown: negatives.filter(r => r.anwendbar === 'nein').length,
      controls, verdict: Object.values(controls).every(v => v === 'Treffer') ? 'Positiv-Kontrolle bestanden' : 'widerlegt nach Positiv-Kontroll-Kriterium dieses Briefs' };
  });
}
function csv(rows) {
  if (!rows.length) throw new Error('Empty population');
  const columns = Object.keys(rows[0]);
  const escape = x => '"' + String(x ?? '').replaceAll('"', '""') + '"';
  return [columns.join(','), ...rows.map(r => columns.map(k => escape(r[k])).join(','))].join('\n') + '\n';
}
function report(population, boards, scanned, groupingHash, rows) {
  const summary = summarize(rows);
  const boardRows = rows.filter(r => r.im_brett === 'ja' && r.option === 'A');
  const n = scanned.candidates.length;
  return `# T322 — ADS-Verhältnis: Offline-Messung vom 20.09.2026

**Messung, keine Empfehlung und kein Fix.** Die Zahlen unten gelten für die expliziten Operationalisierungen A/B und die wertelosen Abdeckungsszenarien C. Sie beweisen keine tatsächlichen ADS-Verhältnisse. Konfidenz der Übertragbarkeit auf eine spätere Implementierung: offen; mechanische Zählungen sind reproduzierbar.

## Population und Abweichung vom Brief

**225 = Obergrenze der Population, 7 = Brett-Zeilen, 2 = belegt falsche Brett-Zeilen** ist der vorgegebene Vorbefund; 225 ist keinesfalls die Anzahl betroffener Brett-Zeilen.
Im zugelassenen Ordner werden tatsächlich ${population.snapshots} Snapshot-Dateien gelesen, ${population.delisted} delistete und ${population.missing} ohne positive Stückzahl/Größe ausgeschlossen: ${population.legs.length} verwendbare Snapshots.
Mit der unten festgelegten Auswahl entstehen ${scanned.eligiblePairs} ganzzahlige US/Nicht-US-Paare, ${scanned.discrepantPairs} Paare mit Abstand >1,5, ${scanned.issuers} Emittenten und ${n} US-Ticker-Kandidaten. Ein Paar ist kein Emittent; mehrere US-Aktiengattungen bleiben getrennte CSV-Zeilen.
Die behauptete Auswahl von exakt 225 Kandidaten ist damit **nicht reproduziert**. Keine Zeilen wurden auf 225 aufgefüllt oder abgeschnitten. Eine verbindliche Kandidatenliste und die ursprüngliche Ganzzahligkeits-Toleranz fehlen. Die CSV enthält ${n} × 5 = ${rows.length} Zeilen.
Im jüngsten lokalen Vintage **${boards.vintage}** stehen ${boardRows.length} dieser US-Ticker: ${boardRows.map(r => r.ticker).join(', ')}. Die sieben Kontrollnamen werden zusätzlich separat geprüft; fremde Kontrolllabels wurden nicht in die Entscheidungsfunktionen eingespeist.

## Festgelegte Messregeln und Grenzen

- Gruppierung und Abstandsfunktion werden direkt aus den zwei reinen Funktionen des bestehenden Währungswächters ausgeführt; sein Live-Teil und seine Produktionsimporte laufen nicht. Seine Einschränkung auf Gruppen mit mindestens zwei ursprünglichen Handelswährungen bleibt erhalten. Keine OTC-, A/H- oder Vorzugsfilter zusätzlich: das ist eine Kandidaten-Obermenge, kein ADR-Nachweis.
- US-Linie = Ticker ohne Punkt. meta.region wird weder gelesen noch als US-Kriterium benutzt. Namensgleichheit stammt unverändert aus dem Wächter; sie beweist keine identische Aktiengattung.
- Ganzzahligkeit: größerer/kleinerer Stückzahlwert liegt höchstens 3 % relativ neben der nächsten ganzen Zahl (eins eingeschlossen). Diese deklarierte Messannahme übernimmt die 3-%-Toleranz des Bausteins; die Toleranz des Vorbefunds ist unbekannt. Kandidat: mindestens ein solches Paar mit mcap-Abstand strikt >1,5. Alle Gegenlinien bleiben anschließend für Mehrdeutigkeitsprüfungen erhalten.
- A: bei ungleichen Stückzahlen wird das gerichtete, auf eine ganze Zahl bzw. deren Kehrwert gerundete Stückzahlverhältnis als Korrekturfaktor angenommen. Bei annähernd gleichen Stückzahlen wird das ganzzahlige Kursverhältnis in derselben ausdrücklich belegten Währung verwendet. Alle Gegenlinien müssen denselben Faktor liefern; sonst keine Anwendung. Das ist eine **bedingte Konsistenz-Heuristik**, kein Beweis, welche Stückzahldefinition der Lieferant verwendet. Insbesondere kann reine Konsistenz einen ADS-Effekt nicht von anderen Gattungen oder veralteten Kursen unterscheiden.
- B: mangels Primär-/Heimatkennzeichnung wird die **einzige** Nicht-US-Gegenlinie bedingt als Heimat-Linie eingesetzt. Mehrere Gegenlinien sind nicht entscheidbar; es wird keine willkürlich ausgewählt. Dies misst ausdrücklich die Fremdlinien-als-Heimat-Annahme, nicht eine bereits validierte Heimat-Zuordnung. Der Brief belegt, dass diese Annahme bei den fünf US-Primärlinien falsch ist; jede numerische Änderung dort zählt dennoch und gerade deshalb als Kollateralschaden. Eine echte Heimat-Auswahl benötigt weitere Stammdaten.
- C: eine Abdeckung allein liefert **keinen Verhältniswert und keine Stückzahl-Semantik**. Es werden keine Werte erfunden und weder A noch B als angebliche externe Tabelle ausgegeben. 100 % deckt alle ${n} Ticker hypothetisch; 50 % die ersten ${Math.floor(n / 2)} ASCII-sortierten Ticker (abgerundet; keine Zufallsstichprobe); nur-die-7 die sieben Kontrollnamen. Alle numerischen Wirkungen bleiben unentscheidbar, auch innerhalb der angenommenen Abdeckung. Für nominell 225 wären 50 % zwischen 112 und 113 Einträgen; eine exakte halbe Zeile existiert nicht.
- Keine neue Währungsumrechnung: price.currencyUnit / meta.priceCurrency kennzeichnen bereits normalisierte Preise (haben Vorrang vor price.currency, das z.B. HKD als Originalwährung trägt). Widersprechende Stempel sperren den Kursvergleich. Für marketCap gilt eine explizite Währung oder der vorhandene tradingFxRateApplied-Stempel als USD-Nachweis. Der Kursstempel wird nie selbst zum Umrechnen genutzt. Fehlt eine gemeinsame Einheit: **nicht entscheidbar ohne Kurs**. Es wird nie ein FX-Kurs aus mcap/Kurs/Stückzahl rückgerechnet.
- Richtung beschreibt die bedingte Diagnose gegenüber heute: Faktor <1 = heute zu groß, >1 = heute zu klein. Das ist außerhalb der Kontrollen keine verifizierte Wahrheit. Unentscheidbare Werte sind leer, keinesfalls Faktor 1 oder null Kapitalisierung. Rang ist der vorhandene kohortenspezifische Rang; es werden keine neuen Scores oder Ränge gerechnet.
- Trefferprüfung: Faktor innerhalb 3 % relativ um HSAI 1/7,87 bzw. LU 2. Jede numerische Veränderung der fünf korrekten Namen zählt ohne Bagatellschwelle als Schaden. Nichtanwendung wird separat als unentscheidbar gezählt, nicht als belegte Unversehrtheit der hypothetischen Option.

## Pflichtkennzahlen

**Kollateralschaden ist die wichtigste Kennzahl.** Die zweite Schadensspalte darf nicht mit null Schaden verwechselt werden.

| Option | Anwendbar / ${n} | Ohne Kurs | C-Abdeckung angenommen | HSAI | LU | Schäden / 5 | Unentscheidbar / 5 |
|---|---:|---:|---:|---|---|---:|---:|
${summary.map(s => `| ${s.option} | ${s.applicable} | ${s.fxMissing} | ${s.covered} | ${s.controls.HSAI} | ${s.controls.LU} | ${s.collateral} | ${s.collateralUnknown} |`).join('\n')}

${summary.map(s => `- ${s.option}: ${s.verdict}.`).join('\n')}

„Widerlegt“ bedeutet hier das vom Brief geforderte Nichtbestehen beider Positiv-Kontrollen für diese messbare Ausgestaltung. Bei C fehlen Werte; damit ist keine Aussage über die Güte einer zukünftig tatsächlich befüllten Tabelle möglich. Bei A ist das Bestehen der zwei Kontrollen keine Validierung für die restliche Population.

## Die sieben Brett-Kontrollen

| Ticker | Option | Rang heute | Gegenlinie(n) | mcap heute | mcap unter Option | Faktor | Einordnung |
|---|---|---:|---|---:|---:|---:|---|
${rows.filter(r => SEVEN.includes(r.ticker)).map(r => `| ${r.ticker} | ${r.option} | ${r.rang_heute} | ${r.heimat_linie.replaceAll('|', ', ')} | ${r.mcap_heute.toFixed(2)} | ${r.mcap_unter_option?.toFixed(2) ?? 'offen'} | ${r.faktor?.toFixed(6) ?? 'offen'} | ${r.einordnung} |`).join('\n')}

Die LU-Heimat-Ersetzung B ergibt mit diesen Dateien Faktor ${rows.find(r => r.ticker === 'LU' && r.option === 'B')?.faktor?.toFixed(6) ?? 'offen'}; das ist nicht der Faktor 2 der Positiv-Kontrolle. Verschiedene Fundamentaldaten-/Kursstichtage und unbekannte Gattungsdefinitionen bleiben offen. Die fünf laut Brief heute korrekten US-Primärlinien sind UEC, INTC, JBS, MGNI und WSC. HSAI und LU sind die zwei belegt falschen Zeilen; alle anderen Populationsnamen erhalten kein erfundenes Wahrheitslabel.

## Reproduktion und Provenienz

\`node scripts/t322-ads-verhaeltnis-optionen.js\` (optional \`--population <17-shard-directory>\`), danach \`node tests/t322-ads-verhaeltnis-optionen.test.js\`.
Schreibziele sind ausschließlich die zwei fest benannten Reports. Das lokale snapshots/ wird ausdrücklich abgelehnt. Keine Netzaufrufe, keine neuen Dependencies, keine Änderungen an Daten, Brettern oder Scoring.

- Eingabepfad: ${population.root}
- SHA-256 Snapshot-Pfad-/Bytefolge: ${population.hash}
- SHA-256 verwendete Board-Dateien: ${boards.hash}
- SHA-256 unverändert wiederverwendete Wächter-Funktionen: ${groupingHash}
- Technische Bruchprobe: Test kopiert den Messcode nur im Speicher, setzt die Kollateralzählung auf 0 und verlangt denselben roten Testausgang; der normale Messcode bleibt unverändert. Ergebnis wird im Testprotokoll ausgewiesen.
`;
}
function run(directory = DEFAULT_POPULATION) {
  const population = readPopulation(directory), boards = readBoards(), grouping = loadGrouping();
  const scanned = scan(population.legs, grouping.group);
  const rows = measure(scanned.candidates, boards.ranks);
  for (const t of SEVEN) {
    if (!rows.some(r => r.ticker === t && r.im_brett === 'ja')) throw new Error(`Missing board control: ${t}`);
  }
  const md = report(population, boards, scanned, grouping.hash, rows);
  fs.writeFileSync(OUTPUT + '.csv', csv(rows));
  fs.writeFileSync(OUTPUT + '.md', md);
  console.log(`Snapshots ${population.snapshots}; usable ${population.legs.length}; issuers ${scanned.issuers}; candidates ${scanned.candidates.length}; CSV rows ${rows.length}`);
  for (const s of summarize(rows)) console.log(`${s.option}: applicable=${s.applicable}; FX-missing=${s.fxMissing}; HSAI=${s.controls.HSAI}; LU=${s.controls.LU}; collateral=${s.collateral}/5; unresolved=${s.collateralUnknown}/5; covered=${s.covered}`);
  return { population, boards, scanned, rows };
}
module.exports = { DEFAULT_POPULATION, OUTPUT, OPTIONS, SEVEN, CORRECT, POSITIVE, loadGrouping,
  asLeg, isUSLine, readPopulation, readBoards, scan, estimate, measure, summarize, csv, report, run };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--population')) throw new Error('Usage: node script [--population DIRECTORY]');
  run(args[1]);
}
