#!/usr/bin/env node
'use strict';
// Offline measurement. Only REPORT is written; inputs are never imported.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'data-health/annual-spikes-baseline.json');
const WATCH = path.join(ROOT, 'scripts/watch-annual-spikes.js');
const REPORT = path.join(ROOT, 'reports/t-kdrift-signatur-2026-09-20.md');
const SCRATCH = 'C:/Users/Anwender/AppData/Local/Temp/claude/C--Users-Anwender-Market-Structure-research/754a849d-444e-4e77-98cd-1d62ad581fad/scratchpad';
const DEFAULTS = ['ci-pop-35438100627', 'ci-merged-35500025507'].map(p => path.join(SCRATCH, p));
const FIELDS = ['annualOpInc', 'annualRev', 'annualNetIncome'];
const PARTS = ['links', 'wert', 'rechts'];
const UNKNOWN = 'nicht entscheidbar mit 2 Ständen';
const LIMIT = 0.01, EPS = 1e-10;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const row = cells => '| ' + cells.map(v => String(v).replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ')).join(' | ') + ' |';
const fmt = x => Number.isFinite(x) ? String(x) : 'n/a';
const key = x => `${x.ticker}|${x.reihe}|${x.index}`;

function extract(source) {
  // Same declaration/function extraction as t-jahresausreisser-klassifikation.js.
  const functions = ['findeAusreisser', 'stabilerSchluessel', 'fundeJeReihe',
    'altIndexEintraege', 'istBekannt', 'faktorGleicheFaelle', 'ereignisse'];
  const declarations = ['FAKTOR', 'MIN_BETRAG', 'REIHEN', 'FAKTOR_GLEICH_TOL',
    'ausreisserFaktor', 'r1Schluessel', 'r2Schluessel'];
  const extracted = declarations.map(n => {
    const m = source.match(new RegExp('^const ' + n + ' = [^\\n]+;', 'm'));
    assert(m, 'Missing declaration: ' + n); return m[0];
  }).concat(functions.map(n => {
    const m = source.match(new RegExp('^function ' + n + '\\([^]*?^}', 'm'));
    assert(m, 'Missing pure function: ' + n); return m[0];
  })).join('\n');
  assert(!/require\(|process\.|fs\./.test(extracted), 'Unexpected I/O in extraction');
  return vm.runInNewContext(extracted + '\n({' + functions.join(',')
    + ',ausreisserFaktor,r2Schluessel})', {}, { timeout: 1000 });
}

function scan(root, api) {
  const tickers = new Set(), hits = new Map(), digest = crypto.createHash('sha256');
  let manifests = 0;
  function walk(dir) {
    assert(!fs.lstatSync(dir).isSymbolicLink(), 'No links: ' + dir);
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(dir, e.name);
      assert(!e.isSymbolicLink(), 'No links: ' + file);
      if (e.isDirectory()) walk(file);
      else if (e.name.endsWith('.json')) {
        const bytes = fs.readFileSync(file), s = JSON.parse(bytes);
        digest.update(path.relative(root, file).replace(/\\/g, '/') + '\0' + hash(bytes) + '\n');
        if (e.name === '_manifest.json' && !s.meta && !s.annual
          && typeof s.pulled_at === 'string' && Number.isInteger(s.n_total) && Number.isInteger(s.n_ok)) {
          manifests++;
          continue;
        }
        assert(typeof s.meta?.ticker === 'string' && s.annual, 'Unexpected non-snapshot: ' + file);
        assert(!tickers.has(s.meta.ticker), 'Duplicate ticker: ' + s.meta.ticker);
        tickers.add(s.meta.ticker);
        for (const reihe of FIELDS) for (const x of api.findeAusreisser(s.annual[reihe])) {
          const hit = { ticker: s.meta.ticker, reihe, periode: s.timeseries?.[reihe + 'Ends']?.[x.index], ...x };
          hits.set(key(hit), hit);
        }
      }
    }
  }
  walk(root);
  assert(tickers.size, 'Empty population: ' + root);
  return { root, tickers, hits, manifests, digest: digest.digest('hex') };
}

function measure(hit, base, api, known) {
  if (!hit || !base) return null;
  const ratios = PARTS.map(p => base[p] === 0 ? null : hit[p] / base[p]);
  const finite = ratios.filter(Number.isFinite);
  const zeroMismatch = PARTS.some(p => base[p] === 0 && hit[p] !== 0);
  const span = finite.length ? Math.max(...finite) - Math.min(...finite) : null;
  return { ratios, span, zeroMismatch, exact: known.has(api.stabilerSchluessel(hit)) };
}

function verdict(ms) {
  if (ms.some(m => !m || m.zeroMismatch || m.ratios.some(k => k !== null && !Number.isFinite(k)))) return UNKNOWN;
  const directions = [];
  for (let c = 0; c < 3; c++) {
    const ks = ms.map(m => m.ratios[c]);
    if (ks.some(k => k === null)) continue;
    const steps = ks.slice(1).map((k, i) => k - ks[i]);
    const signs = new Set(steps.filter(d => Math.abs(d) > EPS).map(Math.sign));
    if (steps.some(d => Math.abs(d) > LIMIT) || signs.size > 1) return 'sprung';
    directions.push(steps.every(d => Math.abs(d) > EPS) && signs.size === 1 ? [...signs][0] : 0);
  }
  if (ms.length >= 3 && ms.every(m => m.span !== null && m.span <= EPS)
    && directions.length && directions.every(d => d !== 0 && d === directions[0])) return 'drift';
  return UNKNOWN;
}

function selfTest(api) {
  const m = k => ({ ratios: [k, k, k], span: 0, zeroMismatch: false });
  assert.equal(verdict([m(1), m(1.005)]), UNKNOWN);
  assert.equal(verdict([m(1), m(1.005), m(1.009)]), 'drift');
  assert.equal(verdict([m(1), m(0.996), m(0.992)]), 'drift');
  assert.equal(verdict([m(1), m(1.02)]), 'sprung');
  assert.equal(verdict([m(1), m(1.005), m(1.004)]), 'sprung');
  assert.equal(verdict([m(1), m(1), m(1)]), UNKNOWN);
  assert.equal(verdict([m(1), null, m(1.005)]), UNKNOWN);
  assert.equal(verdict([m(1), { ...m(1), zeroMismatch: true }]), UNKNOWN);
  assert.equal(verdict([m(1), m(1.004), { ...m(1.008), span: 0.002 }]), UNKNOWN);
  assert.equal(api.findeAusreisser([{ value: 1e6 }, { value: 100e6 }, { value: 2e6 }])[0].index, 1);
  console.log('Self-checks: 10 passed (direction, jump, missing, zero, nonuniform, extraction).');
}

function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length >= 2, 'Usage: node scripts/t-kdrift-signatur.js <lauf1> <lauf2> [...]');
  const roots = (args.length ? args : DEFAULTS).map(p => path.resolve(p));
  assert.equal(new Set(roots.map(p => p.toLowerCase())).size, roots.length, 'Repeated run directory');
  const before = hash(fs.readFileSync(BASE)), source = fs.readFileSync(WATCH, 'utf8');
  const baseline = JSON.parse(fs.readFileSync(BASE)), api = extract(source);
  const known = new Set(baseline.faelle), candidates = new Map();
  for (const signature of known) {
    const match = signature.match(/^([^|]+)\|([^|]+)\|werte:([^|]+)\|([^|]+)\|([^|]+)$/);
    assert(match, 'Unsupported baseline signature: ' + signature);
    const [, ticker, field, l, v, r] = match;
    const b = { signature, links: Number(l), wert: Number(v), rechts: Number(r) };
    assert(PARTS.every(p => Number.isFinite(b[p])), 'Nonfinite baseline');
    const k = ticker + '|' + field;
    if (!candidates.has(k)) candidates.set(k, []);
    candidates.get(k).push(b);
  }
  selfTest(api);
  const runs = roots.map(p => scan(p, api));
  const union = new Set(runs.flatMap(r => [...r.tickers]));
  const common = new Set([...union].filter(t => runs.every(r => r.tickers.has(t))));
  const hitKeys = [...new Set(runs.flatMap(r => [...r.hits.keys()]))].sort();
  const counts = { drift: 0, sprung: 0, [UNKNOWN]: 0 }, excluded = [], table = [], details = [];
  let unchanged = 0, withoutBaseline = 0;
  for (const k of hitKeys) {
    const hits = runs.map(r => r.hits.get(k)), first = hits.find(Boolean);
    if (!common.has(first.ticker)) {
      excluded.push(row([first.ticker, first.reihe, first.index,
        ...runs.map(r => r.tickers.has(first.ticker) ? 'vorhanden' : 'fehlt'), UNKNOWN]));
      continue;
    }
    // Select once against the first observed hit; never reselect as values move.
    const options = [...(candidates.get(first.ticker + '|' + first.reihe) || [])];
    options.sort((a, b) => Math.abs(api.ausreisserFaktor(a) - api.ausreisserFaktor(first))
      - Math.abs(api.ausreisserFaktor(b) - api.ausreisserFaktor(first)) || a.signature.localeCompare(b.signature, 'en'));
    const base = options[0], ms = hits.map(h => measure(h, base, api, known));
    if (!base) withoutBaseline++;
    if (hits.every(h => h && PARTS.every(p => h[p] === first[p]))) unchanged++;
    const cls = verdict(ms); counts[cls]++;
    const deltas = ms.slice(1).map((m, i) => m && ms[i] ? PARTS.map((_, c) =>
      m.ratios[c] === null || ms[i].ratios[c] === null ? 'n/a' : fmt(m.ratios[c] - ms[i].ratios[c])).join(' / ') : 'n/a');
    table.push(row([first.ticker, first.reihe, first.index,
      ...ms.map(m => m ? m.ratios.map(fmt).join(' / ') : 'n/a'), ...deltas,
      ms.map(m => m ? (m.exact ? 'ja' : 'nein') : 'n/a').join(' / '), cls]));
    details.push(row([first.ticker, first.reihe, first.index, base?.signature || 'kein Eintrag', options.length,
      ...ms.map(m => m ? fmt(m.span) + (m.zeroMismatch ? '; Nullbasis verändert' : '') : 'n/a'),
      hits.map(h => h ? 'Fund' : 'kein Fund').join(' / ')]));
  }
  const summary = `**Gesamturteil (vorläufig): drift ${counts.drift} / sprung ${counts.sprung} / nicht entscheidbar ${counts[UNKNOWN]} (Feldzeilen der Ticker-Schnittmenge). Zwei Stände können eine Drift-Richtung nicht belegen.**`;
  const labels = runs.map((_, i) => `Lauf ${i + 1}`);
  const lines = [summary, '', '# Signatur-Quotienten — 20.09.2026', '',
    'AUF EINEN BLICK: Rein deskriptive Offline-Messung aller Wächter-Feldfunde in mindestens einem Lauf. Keine Verankerung, keine Baseline-Änderung und keine Aussage zur Ursache. Konfidenz 100 % für die reproduzierten Zähler dieser Eingaben; keine quantifizierte FX-/Quellenwahrscheinlichkeit.', '',
    `Messbefund: ${unchanged} von ${table.length} verglichenen Feldzeilen haben in allen Läufen exakt dieselben drei Signaturwerte; ${withoutBaseline} Zeilen haben keinen Baseline-Eintrag und deshalb kein k. Ein Abstand zur Baseline ist keine zeitliche Veränderung zwischen diesen Läufen.`, '',
    '## Population und Reproduktion', '',
    'Aufruf: `node scripts/t-kdrift-signatur.js <lauf1> <lauf2> [...]`; ohne Argumente werden die beiden vorgegebenen Stände verwendet. Argumente müssen chronologisch geordnet sein; die Reihenfolge ist eine Annahme des Aufrufers, keine aus Verzeichnisnamen verifizierte Zeitreihe. Einziger Schreibpfad: dieser Bericht (auch bei späteren Läufen bleibt der Dateiname gleich).', '',
    'Die Vorgaben bezeichnen Lauf 35438100627 als roh (17 Shards) und Lauf 35500025507 als gemergt. Diese unterschiedliche Population ist kein k-Signal. Die Vorgabe nennt 30 Stunden Abstand; eine Kursbewegung von etwa 0,5 % wird dabei als plausibel angenommen, hier ohne externe Kursdaten nicht geprüft. Ein Beleg erfordert erst eine Reihe über mehrere Tage und einen unabhängigen FX-Abgleich.', '',
    `Ticker-Union: ${union.size}; Schnittmenge über alle ${runs.length} Läufe: ${common.size}; nicht in allen Läufen: ${union.size - common.size}; nur in genau einem Lauf: ${[...union].filter(t => runs.filter(r => r.tickers.has(t)).length === 1).length}. Ausschließlich die Schnittmenge geht in Vergleich und Gesamturteil ein.`, '',
    row(['Lauf', 'Pfad', 'Ticker', 'Feldfunde', 'Manifeste (keine Ticker)', 'nur in diesem Lauf', 'Populations-SHA256']), row(Array(7).fill('---')),
    ...runs.map((r, i) => row([labels[i], r.root, r.tickers.size, r.hits.size,
      r.manifests,
      [...r.tickers].filter(t => runs.every((other, j) => j === i || !other.tickers.has(t))).length, r.digest])), '',
    '## Messregel und Grenzen', '',
    'Extraktion der reinen Wächter-Funktionen wie in scripts/t-jahresausreisser-klassifikation.js, ohne Modulimport oder transitive Scoring-Imports. Feldfunde aus annual.<feld>; Periodenauflösung aus timeseries.<feld>Ends wie dort. Keine Behauptung vollständiger main()-Parität. Daten-JSON muss ein Snapshot oder ein anhand Name und Schema erkanntes _manifest.json sein; Manifeste gehen nur in den Dateihash ein. Duplikate, Links, unbekannte Metadaten und Parsefehler brechen den Lauf ab.', '',
    'k wird für links / wert / rechts getrennt und ungerundet ausgewiesen. Spanne = max(k) − min(k) der definierten Komponenten. 0/0 bleibt n/a; Nullbasis mit Nichtnullwert macht die Zeile unentscheidbar. Exakt bedeutet vollständiger stabiler Signaturtreffer in der Baseline, nicht gerundete Nähe. Fehlender Ticker oder Feldfund ist n/a, niemals 0.', '',
    'Mehrere Baseline-Einträge: Auswahl anhand des nächstliegenden Ausreisserfaktors zum ersten vorhandenen Fund (wie im Klassifikationsskript); Gleichstand lexikographisch. Dieser Eintrag bleibt über ALLE Läufe fest. Die gewählte Signatur und Kandidatenzahl stehen unten. Die Baseline enthält keinen Jahresindex: gleiche Indexposition ist ein Proxy, keine gesicherte Jahresidentität; Rollovers können daher wie Quellenänderungen aussehen.', '',
    `Schwelle: |delta_k| > ${LIMIT} je aufeinanderfolgenden Lauf und je definierter Komponente ergibt sprung; ebenso ein Vorzeichenwechsel der Schritte einer Komponente (numerisches Rauschen bis ${EPS} ignoriert). Die absolute Schwelle entspricht bei k nahe 1 ungefähr 1 %: bewusst doppelt so groß wie die im Brief genannten 0,5 %, eine transparente heuristische Trennlinie, keine validierte FX-Grenze (Konfidenz 60 % für ihre Eignung). Sie wird nicht an die Messwerte angepasst und ist nicht zeitnormalisiert; bei längeren Abständen nur eingeschränkt vergleichbar.`, '',
    `drift verlangt mindestens drei vollständige Stände, jeden Schritt ungleich null, gleiches Vorzeichen in allen definierten Komponenten, |delta_k| <= ${LIMIT} und je Lauf Komponentenspanne <= ${EPS}. Konstante Reihen, uneinheitliche Komponenten oder fehlende Beobachtungen bleiben unentscheidbar. Der vorgegebene Klassenname „${UNKNOWN}“ bleibt aus Formatgründen auch bei mehr als zwei unzureichenden Ständen bestehen.`, '',
    'Zwei Stände können eine Drift-Richtung nicht belegen. Ein großer Schritt kann bereits mit zwei Ständen als sprung markiert werden; kleine Schritte belegen noch keine drift. Auch monotone k-Werte beweisen keine FX-Ursache, und Sprünge beweisen keinen Quellenwechsel. Wiederholte CI-Snapshots können denselben alten Abruf enthalten und sind dann keine unabhängigen Aktualisierungen. Keine Empfehlung zu Weg C.', '',
    '## Vergleich der Feldzeilen in der Schnittmenge', '',
    'Je k- und delta_k-Zelle: links / wert / rechts. Delta-Zellen stehen für aufeinanderfolgende Läufe, nicht nur für Endpunkt minus Startpunkt. Exakt-Spalte folgt der Laufreihenfolge.', '',
    row(['ticker', 'feld', 'index', ...labels.map(l => `k(${l})`), ...labels.slice(1).map((_, i) => `delta_k(${i + 1}→${i + 2})`), 'exakt?', 'Urteil']),
    row(Array(5 + runs.length + runs.length - 1).fill('---')), ...table, '',
    '## Fester Baseline-Bezug und Komponentenspanne', '',
    row(['ticker', 'feld', 'index', 'Baseline-Signatur', 'Kandidaten', ...labels.map(l => `Spanne ${l}`), 'Fundstatus']),
    row(Array(6 + runs.length).fill('---')), ...details, '',
    `## Ausgeschlossene Feldzeilen außerhalb der Schnittmenge (${excluded.length})`, '',
    'Diese Zeilen zählen nicht im Gesamturteil. Wegen fehlender Ticker sind sie nicht entscheidbar; es wird kein delta_k berechnet.', '',
    row(['ticker', 'feld', 'index', ...labels, 'Urteil']), row(Array(4 + runs.length).fill('---')), ...excluded, '',
    '## Unverändertheit und offene Punkte', '',
    `Baseline SHA256 vorher: ${before}.`,
    `Wächter SHA256: ${hash(source)}. Populationshash: sortierte relative Pfade plus SHA256 der Originalbytes.`,
    'Offen: dritter zeitlich späterer Stand, verifizierte Abruf-/Jahresidentität und unabhängiger FX-Abgleich. Alle Feldfunde werden gemessen, nicht nur die acht im Brief erwähnten (b)-Zeilen; eine Klassifikationsauswahl wird nicht als Tatsachenfilter nachgebaut.',
    'Brief-Feedback: Die klaren Schreib- und Netzgrenzen erlauben eine vollständig lokale Messung. Die kausale Gleichsetzung monoton = FX bzw. Sprung = Quelle ist stärker als die Messung tragen kann.', ''];
  const after = hash(fs.readFileSync(BASE));
  assert.equal(after, before, 'Baseline changed');
  assert.equal(hash(fs.readFileSync(WATCH)), hash(source), 'Watcher changed');
  lines.push(`Baseline SHA256 nachher: ${after}. Bytegleich; nicht ergänzt, nicht sortiert, nicht geschrieben.`, '');
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  console.log(summary);
  console.log(`Population: ${runs.map(r => r.tickers.size).join(' / ')}; intersection ${common.size}; excluded field rows ${excluded.length}.`);
  console.log(`Baseline SHA256 before: ${before}\nBaseline SHA256 after:  ${after}`);
  console.log('Report written: ' + REPORT);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
}
