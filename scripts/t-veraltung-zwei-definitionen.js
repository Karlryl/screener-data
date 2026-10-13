#!/usr/bin/env node
'use strict';
// Offline comparison; only REPORT is written (selftest fixtures stay in OS temp).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'reports/t-veraltung-zwei-definitionen-2026-09-20.md');
const DAY = 86400000;
const NAMES = ['n_sel_young_enough', 'n_sel_young_and_stale',
  'n_sel_not_young_but_stale', 'n_sel_not_young_unknown'];
const CELLS = ['both', 'only D1', 'only D2', 'neither'];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const row = xs => '| ' + xs.map(x => String(x ?? 'missing').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ')).join(' | ') + ' |';
const share = (n, d) => d ? (100 * n / d).toFixed(2) + ' %' : 'n/a';

function loadRules() {
  const source = fs.readFileSync(path.join(ROOT, 'pull-yahoo.js'), 'utf8');
  // Copy declarations verbatim at runtime, as durchsatz-lesehilfe.js does.
  // No require(pull-yahoo): its lines 28-64 load dependencies and construct Yahoo.
  // Source: 292-301, 308-316, 327-342, 352-358; line ranges also computed below.
  const names = ['fundamentalsStaleness', 'fundamentalsAsOfAgeFromFile', 'readFileHead', 'selectorBucket'];
  const ranges = [];
  const definitions = names.map(name => {
    const m = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert(m, 'Missing declaration: ' + name);
    const start = source.slice(0, m.index).split('\n').length;
    ranges.push(`${name}: pull-yahoo.js:${start}-${start + m[0].split('\n').length - 1}`);
    assert(!/require\(|process\./.test(m[0]), 'Unexpected dependency in ' + name);
    return m[0];
  });
  const api = vm.runInNewContext(definitions.join('\n') + '\n;({' + names.join(',') + '})', {
    fs, Buffer, FUNDAMENTALS_MAX_AGE_MS: 7 * DAY, FUNDAMENTALS_REFRESH_MS: 30 * DAY,
  }, { timeout: 1000 });
  return { api, ranges, sourceHash: hash(source) };
}

function readPopulation(root) {
  assert(!fs.lstatSync(root).isSymbolicLink(), 'Population root must not be a link');
  const snapshots = [], manifests = [], digest = crypto.createHash('sha256');
  let files = 0;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, e.name);
      assert(!e.isSymbolicLink(), 'Links are not supported: ' + file);
      if (e.isDirectory()) { walk(file); continue; }
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const bytes = fs.readFileSync(file), data = JSON.parse(bytes);
      files++;
      digest.update(path.relative(root, file).replace(/\\/g, '/') + '\0' + hash(bytes) + '\n');
      if (/^_manifest.*\.json$/.test(e.name) && !data.meta) {
        manifests.push({ file, data });
      } else {
        assert(data && typeof data === 'object' && !Array.isArray(data), 'Invalid snapshot: ' + file);
        snapshots.push({ file, meta: data.meta || null });
      }
    }
  }
  walk(root);
  // Only adjacent manifest files are read, never sibling populations.
  for (const e of fs.readdirSync(path.dirname(root), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    if (!/^_manifest.*\.json$/.test(e.name)) continue;
    assert(e.isFile() && !e.isSymbolicLink(), 'Invalid adjacent manifest');
    const file = path.join(path.dirname(root), e.name);
    manifests.push({ file, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
  }
  assert(snapshots.length, 'Empty population');
  return { snapshots, manifests, files, digest: digest.digest('hex') };
}

function chooseNow(pop, explicit) {
  if (explicit !== undefined) {
    assert(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(explicit) && Number.isFinite(Date.parse(explicit)), '--now requires ISO with timezone');
    return { now: Date.parse(explicit), reason: '--now override' };
  }
  const timed = pop.manifests.filter(m => Number.isFinite(Date.parse(m.data.pulled_at)));
  if (timed.length) {
    const times = [...new Set(timed.map(m => Date.parse(m.data.pulled_at)))];
    assert.equal(times.length, 1, 'Conflicting manifest timestamps; supply --now explicitly');
    return { now: times[0], reason: 'manifest pulled_at: ' + timed.map(m => m.file).join(', ') };
  }
  const times = pop.snapshots.map(s => Date.parse(s.meta?.fetchedAt)).filter(Number.isFinite);
  assert(times.length, 'Neither manifest pulled_at nor valid fetchedAt available');
  return { now: Math.max(...times), reason: 'max meta.fetchedAt in population (no valid manifest timestamp)' };
}

function measure(pop, now, api) {
  const cells = Object.fromEntries(CELLS.map(c => [c, []]));
  const counters = [0, 0, 0, 0];
  let known = 0, withMeta = 0, none = 0, oldFresh = 0, headMismatch = 0;
  for (const s of pop.snapshots) {
    const meta = s.meta;
    if (meta) withMeta++;
    // D1: pull-yahoo.js:151-153 inventory definition, strict >30d, no fallback.
    // This comment defines a rule, not an exported inventory function.
    const timestamp = meta?.fundamentalsAsOf ? new Date(meta.fundamentalsAsOf).getTime() : NaN;
    const ageD1 = Number.isFinite(timestamp) ? now - timestamp : null;
    if (ageD1 !== null) known++;
    const d1 = ageD1 !== null && ageD1 > 30 * DAY;
    const fundamentalAge = api.fundamentalsAsOfAgeFromFile(s.file, now);
    if (fundamentalAge !== ageD1) headMismatch++;
    // Verbatim predicate/input operations from _getExistingSnapshotAge,
    // pull-yahoo.js:3326-3332; file path and clock supplied by this measurement.
    const head = api.readFileHead(s.file, 500);
    const m = head == null ? null : head.match(/"asOf"\s*:\s*"([^"]+)"/);
    const ms = m ? new Date(m[1]).getTime() : NaN;
    const age = Number.isFinite(ms) ? now - ms : null;
    const bucket = api.selectorBucket(age, fundamentalAge);
    // processOne:3604-3616 and 3665-3668, including young stale SUBSET.
    if (bucket === 'young') {
      counters[0]++;
      if (meta && api.fundamentalsStaleness(meta, now).stale) counters[1]++;
    } else if (bucket === 'overdue') counters[2]++;
    else if (bucket === 'unknown') counters[3]++;
    else if (bucket === 'none') none++;
    else oldFresh++;
    const d2 = bucket === 'overdue';
    cells[d1 ? (d2 ? 'both' : 'only D1') : (d2 ? 'only D2' : 'neither')].push({
      ...s, bucket, headAsOf: m?.[1], headFundamentalAge: fundamentalAge,
    });
  }
  const d1 = cells.both.length + cells['only D1'].length;
  assert.equal(Object.values(cells).reduce((n, xs) => n + xs.length, 0), pop.snapshots.length);
  assert.equal(counters[0] + counters[2] + counters[3] + none + oldFresh, pop.snapshots.length);
  return { cells, counters, d1, known, withMeta, none, oldFresh, headMismatch };
}

function render(root, pop, clock, result, rules) {
  const n = pop.snapshots.length, r = result, iso = new Date(clock.now).toISOString();
  const lines = [
    `**Gleiche Population, gleiche Uhr: D1 misst ${r.d1}/${n} = ${share(r.d1, n)} alte Fundamentaluhren, D2 misst ${r.counters[2]}/${n} = ${share(r.counters[2], n)} alte Fundamentaluhren ausserhalb des 7-Tage-Tors (Konfidenz 100 % fuer diese Messung).**`, '',
    '## Messbasis', '',
    `Quelle: ${root}`, '',
    `JSON-Dateien im Verzeichnis: ${pop.files}; Snapshot-Dateien: ${n}; Manifeste im Verzeichnis: ${pop.files - n}. Die Vorgabe 16.048 bezeichnet JSON-Dateien inklusive Manifest, nicht 16.048 Aktien-Snapshots.`, '',
    `now = ${iso}; Auswahl: ${clock.reason}. Beide Definitionen verwenden exakt diese Uhr.`, '',
    `Nenner beider Hauptanteile: alle ${n} Snapshot-Dateien; davon mit meta: ${r.withMeta}; mit parsebarer meta.fundamentalsAsOf: ${r.known}; ohne parsebare Fundamentaluhr: ${n - r.known}. Unbekannt ist kein Frischebeleg.`, '',
    `Populations-SHA256 (sortierte relative Pfade und Dateihashes, inklusive Manifest): ${pop.digest}. Pull-Quelltext-SHA256: ${rules.sourceHash}.`, '',
    '## Zwei Definitionen', '',
    row(['definition', 'threshold', 'now', 'denominator / unit', 'numerator', 'share']), row(Array(6).fill('---')),
    row(['D1: alte fundamentalsAsOf', 'now - fundamentalsAsOf > 30 Tage', iso, `${n} alle Snapshot-Dateien`, r.d1, share(r.d1, n)]),
    row(['D2: _selNotYoungButStale', 'lesbare asOf; Alter >= 7 Tage UND Kopf-fundamentalsAsOf > 30 Tage', iso, `${n} alle Snapshot-Dateien`, r.counters[2], share(r.counters[2], n)]), '',
    `D1 nur unter lesbaren Fundamentaluhren (separater Nenner, keine Hauptquote): ${r.d1}/${r.known} = ${share(r.d1, r.known)}.`, '',
    'D1-Quelle: pull-yahoo.js:151-153 (Inventar-Kommentar), strikter Altersvergleich auch in :298 und :357; kein fetchedAt-Fallback und kein fundamentalsIncomplete-Override in D1.', '',
    'D2-Quelle: pull-yahoo.js:3322-3333 (asOf aus den ersten 500 Bytes), :3604-3616 (Zaehler), :3665-3668 (junge stale-Teilmenge). fundamentalsAsOf wird fuer D2 aus den ersten 4096 Bytes gelesen. D2 ist der overdue-Eimer, nicht die Vereinigung aller stale-Eimer.', '',
    ...rules.ranges.map(s => '- Unveraendert extrahierte Deklaration: ' + s), '',
    'Schwellen: feste Code-Defaults aus pull-yahoo.js:86-87 und :117-118, 7 und 30 Tage; keine Umgebungsvariablen gelesen. Tatsaechliche CI-Overrides sind im Manifest nicht belegt. Kein Import von pull-yahoo.js oder lib/druckenmiller.', '',
    `Vollstaendiges meta vs. 4096-Byte-Fundamentaluhr: ${r.headMismatch} Abweichungen; asOf im 500-Byte-Kopf nicht lesbar: ${r.none}; alte asOf mit frischer Fundamentaluhr: ${r.oldFresh}.`, '',
    '## Kreuztabelle D1 x D2', '',
    row(['cell', 'count', 'share of all snapshots']), row(Array(3).fill('---')),
    ...CELLS.map(c => row([c, r.cells[c].length, share(r.cells[c].length, n)])), '',
    'Beispiele: erste fuenf Dateien je Zelle in deterministischer Pfadreihenfolge; bei weniger Treffern alle, bei leerer Zelle keine erfundenen Beispiele.', '',
    row(['cell', 'ticker / file', 'fundamentalsAsOf', 'fetchedAt', 'meta.asOf', 'asOf in 500-byte head', 'fundamentalsIncomplete', '4096-byte fundamental age (days)', 'D2 bucket']), row(Array(9).fill('---')),
    ...CELLS.flatMap(c => r.cells[c].length ? r.cells[c].slice(0, 5).map(s => row([c, s.meta?.ticker || path.basename(s.file), s.meta?.fundamentalsAsOf, s.meta?.fetchedAt, s.meta?.asOf, s.headAsOf, s.meta?.fundamentalsIncomplete, s.headFundamentalAge === null ? 'unknown' : s.headFundamentalAge / DAY, s.bucket])) : [row([c, 'keine Treffer', '-', '-', '-', '-', '-', '-', '-'])]), '',
    '## Zaehler und historische Namen', '',
    row(['counter', 'same-population recomputation', 'meaning']), row(Array(3).fill('---')),
    ...NAMES.map((name, i) => row([name, r.counters[i], ['asOf <7d', 'Teilmenge young; fundamentalsStaleness(meta).stale', 'D2 / overdue', 'alte asOf, Fundamentaluhr unbekannt'][i]])), '',
    'Junge stale-Snapshots werden mit fundamentalsStaleness(meta) gezaehlt: fundamentalsIncomplete=true erzwingt stale; sonst erste parsebare Uhr fundamentalsAsOf / fetchedAt >30 Tage; keine parsebare Uhr ergibt stale. Dieser Geschwisterzaehler ist keine D2-Zusaetzlichkeit und darf nicht zum young-Nenner addiert werden.', '',
    ...pop.manifests.flatMap(m => [`Manifest: ${m.file}`, '', row(['field', 'value']), row(['---', '---']), ...Object.keys(m.data).sort().map(k => row([k, JSON.stringify(m.data[k])])), '']),
    `Die historische Bezeichnung „58,2 %“ beschreibt D1, den Anteil alter fundamentalsAsOf ohne asOf-Tor (8.750/15.040 lokale Snapshots laut pull-yahoo.js:151-153); die Kreuztabelle trennt davon ${r.cells['only D1'].length} heutige D1-Treffer ab, die D2 nicht zaehlt.`, '',
    `Die historische Bezeichnung „7,58 %“ beschreibt laut Brief den D2-Zaehler 1.318 geteilt durch 17.393 Eingangssnapshots, also alte Fundamentaluhren ausserhalb des asOf-Tors und keinen allgemeinen Veraltungsanteil; hier stehen dem ${r.cells.both.length} gemeinsame und ${r.cells['only D2'].length} ausschliessliche D2-Treffer gegenueber.`, '',
    'Bis zu diesem Bericht durfte keine der beiden Zahlen allein zitiert werden; auch kuenftig sind Definition, now, Zaehler und Nenner mit anzugeben.', '',
    'Die 19.09.-Zahl stammt laut Brief aus dem lokalen snapshots/-Verzeichnis; dieses wurde nicht gelesen oder erneut gemessen. Sein historischer now ist in den erlaubten Quellen nicht angegeben. Die historischen Zahlen werden deshalb nicht als Reproduktion ausgegeben.', '',
    'Die im Brief genannte Inventar-Nachrechnung mit 1.318 D2-Treffern ist auf dem gelieferten Bestand nicht reproduzierbar; das Manifest nennt n_sel_not_young_but_stale=4 und auch die gemeinsame Nachrechnung findet hier nur 4. Deren 17.393-Nenner ist hier nur als n_eingang_snapshots belegt, nicht als Umfang dieses gelieferten Nachher-Bestands. Die historische Nachrechnung 16.050 / 18 / 1.318 / 0 kann schon wegen 16.047 Snapshot-Dateien kein Zaehlervektor dieser Population sein.', '',
    'Ergebnisgrenze: Die Regeln sind verschieden, aber der historische Abstand 58,2 % zu 7,58 % ist damit nicht quantitativ allein durch Definitionen erklaert. Diese Messung isoliert den Definitionsunterschied auf EINEM Bestand; ein Vorher-Replay oder ein kausaler Vergleich beider historischer Populationen ist mit diesen Quellen nicht moeglich. processOne zaehlt vor dem Abruf im verarbeiteten Slice; hier wird der gesamte gelieferte Nachher-Bestand gemessen. Keine Reparatur und keine Empfehlung, welche Definition gewinnen soll.', '',
    'Reproduktion: `node scripts/t-veraltung-zwei-definitionen.js <population-dir> [--now <ISO>]`; Test: `node scripts/t-veraltung-zwei-definitionen.js --selftest`.', '',
    'Brief-Feedback: Unklar war die Gleichsetzung aller JSON-Dateien mit Snapshots sowie der historischen Nachrechnung mit Manifestwerten. Die feste Quellen- und Schreibgrenze und die gemeinsame Uhr ermoeglichen einen reproduzierbaren Vergleich.', '',
  ];
  return lines.join('\n');
}

function selftest(rules) {
  const now = Date.now(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'two-staleness-'));
  const iso = days => new Date(now - days * DAY).toISOString();
  for (const [ticker, asOf, fundamental] of [['FRESH', 1, 1], ['D1_ONLY', 1, 40], ['BOTH', 20, 40]]) {
    fs.writeFileSync(path.join(dir, ticker + '.json'), JSON.stringify({ meta: { ticker, asOf: iso(asOf), fundamentalsAsOf: iso(fundamental), fetchedAt: iso(fundamental) } }));
  }
  // No parent-directory manifest discovery needed for isolated fixtures.
  const pop = { snapshots: fs.readdirSync(dir).sort().map(f => ({ file: path.join(dir, f), meta: JSON.parse(fs.readFileSync(path.join(dir, f))).meta })) };
  const r = measure(pop, now, rules.api);
  assert.deepEqual(CELLS.map(c => r.cells[c].length), [1, 1, 0, 1]);
  assert.deepEqual(r.counters, [2, 1, 1, 0]);
  assert.equal(r.d1, 2);
  assert.equal(r.headMismatch, 0);
  assert.equal(rules.api.selectorBucket(7 * DAY, 30 * DAY), 'young-enough-clock');
  assert.equal(rules.api.selectorBucket(7 * DAY, 30 * DAY + 1), 'overdue');
  assert.equal(rules.api.selectorBucket(7 * DAY - 1, 40 * DAY), 'young');
  assert.equal(rules.api.selectorBucket(null, 40 * DAY), 'none');
  assert.equal(rules.api.selectorBucket(7 * DAY, null), 'unknown');
  assert.equal(rules.api.fundamentalsStaleness({ fundamentalsIncomplete: true, fetchedAt: iso(0) }, now).stale, true);
  assert.equal(rules.api.fundamentalsStaleness({ fetchedAt: iso(40) }, now).stale, true);
  assert.equal(chooseNow({ manifests: [], snapshots: pop.snapshots }).now, now - DAY);
  console.log('SELFTEST PASS: 3 snapshots; both=1 / only D1=1 / only D2=0 / neither=1; counters=2/1/1/0');
  console.log('PASS: strict 7d/30d boundaries, unknown clocks, sibling overrides, fetchedAt fallback.');
  console.log('Temporary fixtures retained (no deletion): ' + dir);
}

function main(args) {
  let directory, explicit, test = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--selftest') test = true;
    else if (args[i] === '--now') { assert(explicit === undefined && args[i + 1], 'Missing/repeated --now'); explicit = args[++i]; }
    else { assert(!args[i].startsWith('--') && !directory, 'Unexpected argument: ' + args[i]); directory = args[i]; }
  }
  assert(directory || test, 'Usage: <population-dir> [--now <ISO>] [--selftest]');
  const rules = loadRules();
  if (test) selftest(rules);
  if (!directory) { assert(explicit === undefined, '--now requires population-dir'); return; }
  const root = fs.realpathSync(directory);
  assert(!root.toLowerCase().startsWith(path.join(ROOT, 'snapshots').toLowerCase()), 'Local snapshots are forbidden');
  assert(!REPORT.toLowerCase().startsWith(root.toLowerCase() + path.sep), 'Report must be outside population');
  const pop = readPopulation(root), clock = chooseNow(pop, explicit), result = measure(pop, clock.now, rules.api);
  const report = render(root, pop, clock, result, rules);
  const previous = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '';
  fs.writeFileSync(REPORT, previous.includes('\r\n') ? report.replace(/\n/g, '\r\n') : report, 'utf8');
  console.log(report.split('\n')[0]);
  console.log(`now: ${new Date(clock.now).toISOString()} (${clock.reason})`);
  console.log(`JSON=${pop.files}; snapshots=${pop.snapshots.length}; counters=${result.counters.join('/')}`);
  console.log(`Cross: ${CELLS.map(c => c + '=' + result.cells[c].length).join(' / ')}`);
  console.log('Report written: ' + REPORT);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.stack); process.exitCode = 1; }
}
