#!/usr/bin/env node
'use strict';
// Offline audit only. The sole write target is the report below.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const POP = 'C:/Users/Anwender/AppData/Local/Temp/claude/C--Users-Anwender-Market-Structure-research/754a849d-444e-4e77-98cd-1d62ad581fad/scratchpad/ci-pop-35438100627';
const REPORT = path.join(ROOT, 'reports/t-jahresausreisser-nicht-erfasst-2026-09-20.md');
const WATCH = path.join(ROOT, 'scripts/watch-annual-spikes.js');
const BASE = path.join(ROOT, 'data-health/annual-spikes-baseline.json');
const fields = ['annualOpInc', 'annualRev', 'annualNetIncome'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const num = v => v == null ? 'null' : String(v);
const compact = v => Number.isFinite(v) ? (v / 1e6).toFixed(3) : 'null';
const cell = v => String(v).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
const row = values => '| ' + values.map(cell).join(' | ') + ' |';

function main() {
  const source = fs.readFileSync(WATCH, 'utf8');
  const baselineBytes = fs.readFileSync(BASE);
  const baseline = JSON.parse(baselineBytes);
  const sourceHash = hash(source), baselineHash = hash(baselineBytes);
  // Copy only reviewed pure functions into an isolated context, not the module's
  // main()/I/O or transitive scoring imports, which are outside this read scope.
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
  const api = vm.runInNewContext(extracted + '\n({' + functions.join(',')
    + ',ausreisserFaktor,r2Schluessel})', {}, { timeout: 1000 });
  const snapshots = [], digest = crypto.createHash('sha256');
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(dir, e.name);
      assert(!e.isSymbolicLink(), 'No links allowed in population');
      if (e.isDirectory()) walk(file);
      else if (e.name.endsWith('.json')) {
        const bytes = fs.readFileSync(file), s = JSON.parse(bytes);
        assert(s.meta?.ticker && s.annual, 'Unexpected non-snapshot: ' + file);
        const rel = path.relative(POP, file).replace(/\\/g, '/');
        digest.update(rel + '\0' + hash(bytes) + '\n');
        snapshots.push({ s, rel });
      }
    }
  }
  walk(POP);
  assert.equal(snapshots.length, 17392, 'Population file count changed');
  const byTicker = new Map(snapshots.map(x => [x.s.meta.ticker, x]));
  assert.equal(byTicker.size, snapshots.length, 'Duplicate ticker in shards');
  const hits = [], unequal = new Set();
  // Mirror the timeseries-container lookup described in the allowed watcher
  // comments (JA-7/JA-10); measure the annual-container alternative separately.
  assert(baseline.faelle.every(k => /^[^|]+\|[^|]+\|werte:/.test(k)));
  const known = new Set(baseline.faelle);
  for (const { s } of snapshots) {
    const lengths = fields.map(f => s.annual[f]?.length || 0).filter(Boolean);
    if (new Set(lengths).size > 1) unequal.add(s.meta.ticker);
    for (const reihe of fields) for (const x of api.findeAusreisser(s.annual[reihe])) {
      const hit = { ticker: s.meta.ticker, reihe, periode: s.timeseries?.[reihe + 'Ends']?.[x.index], ...x };
      if (known.has(api.stabilerSchluessel(hit))) {
        for (const container of [s, s.timeseries || {}]) {
          assert(!container[reihe + 'Ends']?.[x.index], 'Period-sensitive exact baseline match');
        }
        assert(!s.annual[reihe][x.index].date && !s.annual[reihe][x.index].period,
          'Period-sensitive value object');
      }
      hits.push(hit);
    }
  }
  const counts = api.fundeJeReihe(hits, known);
  const neu = hits.filter(x => !api.istBekannt(x, known, counts));
  const fgl = api.faktorGleicheFaelle(neu);
  const missing = fgl.zweiVonDrei.filter(k => !fgl.gleich.includes(k)).sort();
  const selected = neu.filter(x => missing.includes(api.r2Schluessel(x)))
    .sort((a, b) => api.r2Schluessel(a).localeCompare(api.r2Schluessel(b), 'en') || a.reihe.localeCompare(b.reihe));
  assert.equal(selected.length, missing.length * 2);
  const values = [fgl.zweiVonDrei.length, fgl.gleich.length, missing.length];
  const alternateHits = hits.map(x => ({ ...x,
    periode: byTicker.get(x.ticker).s.annual[x.reihe + 'Ends']?.[x.index] || x.periode }));
  const alternateCounts = api.fundeJeReihe(alternateHits, known);
  const alternate = api.faktorGleicheFaelle(alternateHits.filter(x => !api.istBekannt(x, known, alternateCounts)));
  const alternateMissing = alternate.zweiVonDrei.filter(k => !alternate.gleich.includes(k)).sort();
  assert.equal(JSON.stringify(alternateMissing), JSON.stringify(missing), 'Period ambiguity changes target pairs');
  const matches = values.join('/') === '15/6/9';
  const events = api.ereignisse(neu, t => !unequal.has(t));
  const line = text => source.slice(0, source.indexOf(text)).split('\n').length;
  const lines = [
    `**${matches ? 'REPRODUZIERT' : 'ABWEICHUNG'}: 2-von-3 / faktorgleich / NICHT erfasst = ${values.join(' / ')} (Soll 15 / 6 / 9); Zähleinheit: Ticker-/Index-Paare mit zwei Feld-Funden, also ${missing.length} Paare = ${selected.length} Feldzeilen.**`,
    '', '# Jahres-Ausreisser: nicht erfasste Paare — 20.09.2026', '',
    'AUF EINEN BLICK: Neun Paare sind einzeln unten aufgelöst; Vorschläge sind keine Urteile. Die Entscheidung trifft Claude. Die Auswertung der bereitgestellten Population weicht vom zitierten Log ab; keine Auswahl wurde auf die Sollzahlen zugeschnitten.', '',
    '## Zähleinheit und Reproduktion', '',
    `Quelltext scripts/watch-annual-spikes.js:${line('    zweiVonDrei.push(k);')}: \`zweiVonDrei.push(k);\` mit Schlüssel aus Ticker und Index und \`if (reihen.size !== 2) continue;\`.`,
    `Quelltext :${line('    const [a, b] = [...reihen.values()].map(ausreisserFaktor);')}: \`const [a, b] = [...reihen.values()].map(ausreisserFaktor);\``,
    `Quelltext :${line('    if (Math.max(a, b) / Math.min(a, b) <= toleranz) gleich.push(k);')}: \`if (Math.max(a, b) / Math.min(a, b) <= toleranz) gleich.push(k);\``,
    `Quelltext :${line('    + \` · NICHT erfasst:')}: \`NICHT erfasst: ${'${fgl.zweiVonDrei.length - fgl.gleich.length}'}\`.`, '',
    '**Faktorgleich vergleicht zwei Felder desselben Tickers am selben Index, nicht einen Fund mit der Baseline (Konfidenz 100 % am Code).** Die Baseline bestimmt davor über istBekannt, welche Feld-Funde in neu gelangen. Die Ereignisbildung mittels R1/R2 ist separat; „2-von-3“ ist keine Zwei-Relationen-Zählung. NICHT erfasst bedeutet nur: das zusätzliche Faktor-Gleichheits-Tor greift bei diesem Paar nicht; das Ereignisbudget kann trotzdem rot werden.', '',
    `Bereitgestellter Pfad: \`${POP}\`. Gelesen: ${snapshots.length} JSON-Snapshots, ${hits.length} Feld-Funde, ${neu.length} NEU, ${events.length} Ereignisse über R1/R2. Ticker mit ungleichen Reihenlängen: ${unequal.size}. Keine lokalen snapshots/ gelesen.`,
    `2-von-3-Menge: ${[...fgl.zweiVonDrei].sort().map(k => '`' + k + '`').join(', ')}.`,
    `Faktorgleiche Menge: ${[...fgl.gleich].sort().map(k => '`' + k + '`').join(', ')}.`,
    `Differenzmenge NICHT erfasst: ${missing.map(k => '`' + k + '`').join(', ')}.`, '',
    'INDU-A.ST|2 und INDU-C.ST|2 sind zusätzliche faktorgleiche Paare gegenüber der Tickerliste des Briefs; sie erklären die numerische Differenz +2/+2/0, aber ohne vollständiges CI-Log ist die Ursache der Populations-/Versionsabweichung offen. Ihre Umsatzreihe lautet jeweils 475010477.28 / 0 / 840683238.48 / 68349076.56; die Ergebnisreihe 474435700.3521769 / 0 / 839665986.5409421 / 68266372.1268901. Kein Baseline-Eintrag für INDU-A.ST oder INDU-C.ST. Der Verzeichnisname allein belegt nicht die Laufidentität.', '',
    '## Verfahren und Leseregeln', '',
    'Variante: geprüfte reine Funktionen werden unverändert aus dem Wächterquelltext extrahiert und isoliert ausgeführt (Spiegelung zur Laufzeit); kein Modulimport, damit keine verbotenen transitiven Dateien gelesen werden. Der Dateiscanner ist nachgebildet, liest alle Shards und bricht bei Parsefehlern, Metadateien oder Tickerduplikaten ab. Die Periodenauflösung folgt dem im Wächterkommentar JA-7/JA-10 beschriebenen timeseries-Container; die Implementierung des importierten Scoring-Helfers ist außerhalb der Lesegrenze und deshalb nicht unabhängig geprüft (Konfidenz 85 % für Scanner-Parität). Keine Aussage zur vollständigen main()-Parität oder allen CI-Gates.',
    `Sensitivitätsprüfung: Verwendung der Enden aus annual statt timeseries ergibt ${alternate.zweiVonDrei.length} / ${alternate.gleich.length} / ${alternateMissing.length}; die neun NICHT-erfasst-Paare bleiben exakt dieselben (Assertion bestanden). Der erste Prüfversuch zeigte datierte exakte Baseline-Treffer bei HMMC.TO, HMMCF, MFSL.NS, CRSP, TUB.BR, KYN und TUBI.VI; daher wird Perioden-Unabhängigkeit nur für die neun Zielpaare behauptet, nicht für alle Zähler.`, '',
    'Wert und Nachbarn sind ungerundete Snapshot-Zahlen in USD laut meta.reportingCurrency. Index ist nullbasiert. Angenommen: Reihen sind neuestes Jahr zuerst; vorjahreswert = Index+1 (rechts), links = Index−1. Für die 18 Zeilen fehlen Jahresstempel: Vorjahreszuordnung ist ein Proxy, keine verifizierte Jahresdatierung (Konfidenz 80 %). Faktor = abs(wert) / max(abs(links), abs(rechts)), kein reiner Vorjahresquotient. Fehlende Datierung allein beweist kein Wächter-Artefakt.', '',
    'Baseline-Spalte: ja bedeutet Eintrag derselben Ticker-/Feld-Kombination vorhanden; „exakt“ bezeichnet den tatsächlichen Wertsignaturtreffer. Nächstliegend ist der Baseline-Ausreisserfaktor mit kleinster absoluter Differenz zum aktuellen Faktor. Zusätzlich steht k = aktueller Wert / Baseline-Wert und die Spannweite der drei Komponentenquotienten; ein einheitliches k nahe 1 erklärt mögliche FX-Drift der Signatur, beweist aber keinen Skalenfehler des Sonderjahres.', '',
    'Zweitlinien werden über gleichen normalisierten Firmennamen oder echte gleiche ISIN (keine TICKER:-Platzhalter) im gesamten Bestand gesucht. „Nein“ heißt kein so identifizierter Treffer; Namensvarianten können fehlen (Konfidenz 80 %). Gleicher Wert einer Zweitlinie aus demselben Store ist kein unabhängiger Quellenbeweis und Faktor 1 kein Skalenfehler. Die Suffix-Verteilung allein begründet keine Klasse.', '',
    '## Neun Paare, achtzehn Feldzeilen', '',
    row(['paar','ticker','suffix','feld','index','wert','vorjahreswert','links','faktor','baseline_eintrag_vorhanden','zweitlinie_vorhanden','klasse_vorschlag','beleg']),
    row(Array(13).fill('---')),
  ];
  const classes = { a: 0, b: 0, c: 0, unklar: 0 };
  const normalized = s => (s.meta.name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const sameCompany = (a, b) => normalized(a) && normalized(a) === normalized(b)
    || a.identifier?.primary === 'ISIN' && b.identifier?.primary === 'ISIN'
      && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(a.identifier.value || '') && a.identifier.value === b.identifier.value;
  const classify = (x, s) => {
    const rev = s.annual.annualRev.map(v => compact(v?.value)).join(' / ');
    const gp = compact(s.annual.annualGP?.[x.index]?.value);
    const focus = `${x.reihe}[${x.index}] = ${compact(x.wert)} Mio USD`;
    if (x.ticker.startsWith('VOGL.')) return ['unklar', `${focus}, während Umsatz von ${compact(s.annual.annualRev[x.index + 1].value)} auf ${compact(s.annual.annualRev[x.index].value)} Mio und Bilanzsumme von ${compact(s.annual.annualBalance[x.index + 1].totalAssets)} auf ${compact(s.annual.annualBalance[x.index].totalAssets)} Mio springt; die identische Zweitlinie trennt Strukturwechsel und gemeinsame Quellenkorruption nicht (Ursache offen, Konfidenz 95 %).`];
    if (x.ticker === 'VPLAY-A.ST') return ['unklar', `${focus} steht am selben Index neben OpInc +1070.944 Mio und NetIncome −1015.813 Mio bei GP ${gp} Mio; Vorzeichen-/Feldverdacht bleibt ohne Primärquelle oder datierte Gegenreihe unaufgelöst und ist kein bewiesener Wächterfehler (Konfidenz 95 % für offen).`];
    if (x.ticker === 'DIGIS.MC') return ['b', `${focus} bei Umsatzfolge ${rev} Mio ohne entsprechenden Skalensprung; Rückrechnung mit Snapshot-FX ${s.meta.fxRateApplied} ergibt ${compact(x.wert / s.meta.fxRateApplied)} Mio EUR und passt zur Baseline-Notiz über das FTTH-Verkaufsjahr, deren externe Belege hier nicht erneut geprüft wurden (Vorschlag b, Konfidenz 85 %).`];
    return ['b', `${focus} bei Umsatzfolge ${rev} Mio und GP[${x.index}] ${gp} Mio: operativer/Netto-Verlust bei fortbestehender Umsatzskala ist als Sonderjahr plausibel, ein glatter Skalenbruch ist in diesen Reihen nicht belegt; keine unabhängige Quellenbestätigung (Vorschlag b, Konfidenz 65 %).`];
  };
  for (const x of selected) {
    const { s } = byTicker.get(x.ticker), factor = api.ausreisserFaktor(x);
    assert.equal(s.meta.reportingCurrency, 'USD');
    const candidates = baseline.faelle.filter(k => k.startsWith(x.ticker + '|' + x.reihe + '|werte:')).map(k => {
      const [links, wert, rechts] = k.split('werte:')[1].split('|').map(Number);
      return { links, wert, rechts, factor: api.ausreisserFaktor({ links, wert, rechts }) };
    }).sort((a, b) => Math.abs(a.factor - factor) - Math.abs(b.factor - factor));
    const b = candidates[0];
    const ratios = b ? ['links', 'wert', 'rechts'].filter(k => b[k] !== 0).map(k => x[k] / b[k]) : [];
    const baseText = b ? `ja; exakt ${known.has(api.stabilerSchluessel(x)) ? 'ja' : 'nein'}; Faktor ${b.factor}; k ${x.wert / b.wert}; Spanne ${Math.min(...ratios)}–${Math.max(...ratios)}` : 'nein; nächster Faktor nicht vorhanden';
    const siblings = snapshots.filter(y => y.s.meta.ticker !== x.ticker && sameCompany(s, y.s));
    const siblingText = siblings.length ? 'ja: ' + siblings.map(y => `${y.s.meta.ticker} ${x.reihe}[${x.index}]=${num(y.s.annual[x.reihe]?.[x.index]?.value)}; gleiches Index-Proxy, Jahresdatum ungesichert`).join('; ') : 'nein (Identitätsabgleich, siehe Grenze)';
    const [cls, evidence] = classify(x, s); classes[cls]++;
    lines.push(row([missing.indexOf(api.r2Schluessel(x)) + 1, x.ticker, x.ticker.includes('.') ? x.ticker.split('.').at(-1) : '', x.reihe, x.index, num(x.wert), num(x.rechts), num(x.links), factor, baseText, siblingText, cls, evidence]));
  }
  lines.push('', '## Prüfpfade und Grenzen', '',
    'Je Quelle: JSON-Pfad annual.<feld>[index].value; Nachbarn [index−1]/[index+1], Währung und Abrufzeit unter meta. Auszug der relevanten Reihen in Mio USD (neu → alt):', '',
    row(['Ticker','Snapshot relativ zum Populationspfad','fundamentalsAsOf / fetchedAt','annualRev','annualOpInc','annualNetIncome']), row(Array(6).fill('---')));
  for (const t of [...new Set(selected.map(x => x.ticker))]) {
    const { s, rel } = byTicker.get(t);
    lines.push(row([t, rel, s.meta.fundamentalsAsOf || s.meta.fetchedAt,
      ...['annualRev','annualOpInc','annualNetIncome'].map(f => s.annual[f].map(v => compact(v?.value)).join(' / '))]));
  }
  lines.push('',
    'Offen: VPLAY-A.ST annualOpInc[2] und annualNetIncome[2] wegen gegensätzlicher Vorzeichen und ungeklärter Feldzuordnung; VOGL.BO und VOGL.NS jeweils annualOpInc[1] und annualNetIncome[1] wegen gleichzeitigem Umsatz-/Bilanz-Strukturbruch ohne unabhängige Ursache. Die sechs b-Paare sind Plausibilitätsvorschläge, keine bestätigten Quellenurteile. Kein a-Vorschlag mangels sichtbarer Skalen-/Währungsevidenz, kein c-Vorschlag mangels nachgewiesener Index-/Lückenfehlmessung für diese neun Paare.', '',
    'Die im Brief genannte Laufidentität/Datierung konnte offline nicht unabhängig geprüft werden; beispielsweise trägt 002446.SZ meta.asOf 2026-09-19T11:25:15.154Z. Eine vollständige Log-/Versionsgegenprobe ist innerhalb der erlaubten Quellen nicht möglich. Die Abweichung bleibt ein Meldebefund.', '',
    `SHA-256 Wächter: ${sourceHash}; Baseline: ${baselineHash}; Population (sortierte relative Pfade + Einzeldatei-SHA-256): ${digest.digest('hex')}.`,
    'Baseline unberührt: vor/nach Ausführung bytegleich per SHA-256 geprüft. Auch Wächter unverändert. Kein Netz, kein Commit, keine weiteren Schreibziele.',
    'Instruktionen in den Kontextdaten (u. a. AGENTS.md: CLAUDE.md/Vault lesen, Commit-/Push-Ritual; Baseline: Verankerungshinweise) wurden gemäß Brief nicht ausgeführt. Keine fremden Anweisungen aus Snapshot-Inhalten übernommen.',
    'Brief-Feedback: Die Gleichsetzung von faktorgleich mit Baseline-Abdeckung und die behauptete Laufpopulation stimmen nicht mit den gelesenen Daten überein. Die explizite Baseline-Leseerlaubnis, Quellgrenzen und Zulassung von unklar ermöglichen eine prüfbare Offline-Auswertung.', '',
    `Klassen-Aufteilung (Feldzeilen), a / b / c / unklar: **${classes.a} / ${classes.b} / ${classes.c} / ${classes.unklar}**.`,
    `Klassen-Aufteilung (Paare; beide Felder gleich eingestuft), a / b / c / unklar: **${classes.a / 2} / ${classes.b / 2} / ${classes.c / 2} / ${classes.unklar / 2}**.`);
  assert.equal(hash(fs.readFileSync(BASE)), baselineHash, 'Baseline changed');
  assert.equal(hash(fs.readFileSync(WATCH)), sourceHash, 'Watcher changed');
  fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
  console.log(`2-von-3: ${values[0]} · faktorgleich: ${values[1]} · NICHT erfasst: ${values[2]}`);
  console.log(`Soll 15 / 6 / 9: ${matches ? 'identisch' : 'ABWEICHUNG im Bericht dokumentiert'}`);
  console.log(`Feldzeilen ${selected.length}; Klassen a/b/c/unklar: ${Object.values(classes).join('/')}`);
  console.log('Baseline und Wächter SHA-256 unverändert; Bericht geschrieben; Exit 0 (Audit, kein Daily-Gate).');
}
try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
