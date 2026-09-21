#!/usr/bin/env node
'use strict';
// Offline observation only. Never import the probes: their imports/CLI exceed this task's read scope.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'reports/t178-reihen-zwillinge-2026-09-21.md');
const EXPECTED = '27841c97eb794fa02073cfab8bcf61a7a1edc10ac8c8626a0d4703aeda6d29ae';
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const count = (n, d) => `${n}/${d} (${d ? (100 * n / d).toFixed(2) + ' %' : 'nicht definiert'})`;
const row = xs => '| ' + xs.map(x => String(x ?? 'fehlt').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ')).join(' | ') + ' |';

function loadRules() {
  const file = 'scripts/probe-emittenten-zwillinge.js';
  const bytes = fs.readFileSync(path.join(ROOT, file));
  const source = bytes.toString('utf8');
  const extract = pattern => {
    const match = source.match(pattern);
    assert(match, 'Probe source contract changed: ' + pattern);
    return match[0];
  };
  const unpack = extract(/^const wert = .*;$/m);
  const names = extract(/^  const namen = .*;$/m);
  const predicate = extract(/namen\.length === 1/);
  const api = vm.runInNewContext(`${unpack}\n({wert, sameName: g => {${names}\nreturn ${predicate};}})`, {}, { timeout: 1000 });
  return { ...api, file, sourceHash: hash(bytes) };
}

function canonical(series, rules) {
  // Preserve every position, zeros and full precision. All non-finite/missing cells are gaps.
  const values = Array.isArray(series) ? Array.from(series, x => {
    const v = rules.wert(x);
    return Number.isFinite(v) ? v : null;
  }) : [];
  return { values, key: JSON.stringify(values), usable: values.filter(v => v !== null && v !== 0).length };
}

function cik(value) {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s) && /[1-9]/.test(s) ? s.replace(/^0+/, '') : null;
}

function readPopulation(directory, rules) {
  const root = path.resolve(directory);
  const forbidden = path.join(ROOT, 'snapshots').toLowerCase();
  for (const candidate of [root, fs.realpathSync(root)]) {
    assert(candidate.toLowerCase() !== forbidden && !candidate.toLowerCase().startsWith(forbidden + path.sep), 'Local snapshots are forbidden');
  }
  assert(!fs.lstatSync(root).isSymbolicLink(), 'Population root must not be a link');
  const digest = crypto.createHash('sha256'), snapshots = [];
  let files = 0, manifests = 0;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, e.name);
      assert(!e.isSymbolicLink(), 'Links are forbidden: ' + file);
      if (e.isDirectory()) { walk(file); continue; }
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const bytes = fs.readFileSync(file), s = JSON.parse(bytes);
      files++;
      digest.update(path.relative(root, file).replace(/\\/g, '/') + '\0' + hash(bytes) + '\n');
      if (/^_manifest.*\.json$/.test(e.name) && !s.meta) { manifests++; continue; }
      assert(s && typeof s === 'object' && !Array.isArray(s), 'Invalid snapshot: ' + file);
      const meta = s.meta || {};
      snapshots.push({ file: path.relative(root, file), ticker: meta.ticker || e.name.slice(0, -5),
        name: meta.longName || meta.shortName || meta.name || null,
        exchange: meta.exchangeName ?? null, shares: meta.sharesOutstanding ?? null,
        cik: cik(meta.cik), ...canonical(s.annual?.annualRev, rules) });
    }
  }
  walk(root);
  assert(snapshots.length, 'Empty population');
  return { root, files, manifests, snapshots, digest: digest.digest('hex') };
}

function pairClass(a, b, rules) {
  // Explicit conflicting identifiers take precedence over a name heuristic.
  if (a.cik && b.cik) return a.cik === b.cik ? 'a' : 'b';
  if (a.name && b.name && rules.sameName([a, b])) return 'a';
  return 'c';
}

function measure(pop, rules) {
  const byKey = new Map();
  let reliable = 0;
  for (const s of pop.snapshots) {
    if (s.usable < 3) continue;
    reliable++;
    if (!byKey.has(s.key)) byKey.set(s.key, []);
    byKey.get(s.key).push(s);
  }
  const groups = [], pairs = { a: 0, b: 0, c: 0 };
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const p = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) p[pairClass(members[i], members[j], rules)]++;
    for (const k of ['a', 'b', 'c']) pairs[k] += p[k];
    // Mixed groups: any proven distinct pair => b; otherwise any unresolved pair => c.
    groups.push({ members, pairs: p, kind: p.b ? 'b' : p.c ? 'c' : 'a' });
  }
  return { reliable, groups, pairs, unreliable: pop.snapshots.length - reliable };
}

function render(pop, result, rules) {
  const n = pop.snapshots.length, r = result, g = r.groups.length;
  const totals = Object.fromEntries(['a', 'b', 'c'].map(k => {
    const groups = r.groups.filter(x => x.kind === k);
    return [k, { groups, rows: groups.reduce((sum, x) => sum + x.members.length, 0) }];
  }));
  const pairTotal = Object.values(r.pairs).reduce((a, b) => a + b, 0);
  const summary = `Zusammenfassung: (a) ${totals.a.groups.length}/${g} Gruppen, ${count(totals.a.rows, r.reliable)} Zeilen; (b) ${totals.b.groups.length}/${g} Gruppen, ${count(totals.b.rows, r.reliable)} Zeilen; (c) ${totals.c.groups.length}/${g} Gruppen, ${count(totals.c.rows, r.reliable)} Zeilen.`;
  const lines = ['# T178: Reihen-Zwillinge, CI-Lauf 35500025507', '',
    '## Messbasis und Quellhashes', '', `Populations-SHA256: \`${pop.digest}\` (Sollwert stimmt).`, '',
    `Wiederverwendete Quelle: \`${rules.file}\`; SHA256: \`${rules.sourceHash}\`.`, '',
    `Population: \`${pop.root}\`. Snapshots: ${count(n, pop.files)} JSON-Dateien; Manifeste: ${count(pop.manifests, pop.files)} JSON-Dateien.`, '',
    'Hashmethode wie t-veraltung-zwei-definitionen.js: rekursiv nach Dateinamen sortiert, fuer jede JSON-Datei relativer Pfad mit /, NUL, SHA256 der Rohbytes, LF; SHA256 ueber diese Folge, inklusive Manifest. Keine benachbarten Dateien gelesen.', '',
    '## Umsatzreihen und Belastbarkeit', '',
    'Kanonisch bytegleich bedeutet JSON-serialisierte Zahlenwerte in gespeicherter Reihenfolge, ohne Rundung, ohne FX-Umrechnung, mit allen Lueckenpositionen und Nullen. Zahlen und {value,...} werden gleich entpackt; nicht-endliche/nicht-numerische Werte werden null. Keine Gleichheit der Rohdateien oder Kalenderjahre behauptet. Mindestens drei endliche Werte ungleich null sind erforderlich, negative Werte zaehlen mit.', '',
    `Belastbar: ${count(r.reliable, n)} Snapshots. Nicht belastbar: ${count(r.unreliable, n)} Snapshots.`, '',
    `In Mehrfachgruppen: ${count(Object.values(totals).reduce((sum, x) => sum + x.rows, 0), r.reliable)} belastbare Snapshots. Gruppen: ${count(g, new Set(pop.snapshots.filter(x => x.usable >= 3).map(x => x.key)).size)} verschiedene belastbare Reihen.`, '',
    '## Identitaet und Klassen', '',
    `CIK-Prueffeld: meta.cik; vorhanden/gueltig: ${count(pop.snapshots.filter(x => x.cik).length, n)} Snapshots. Der Bestands-Scan fand auch an anderen Feldpfaden keine CIK-/ISIN-/Issuer-Felder. Identitaetsnahe vorhandene Felder: meta.name, meta.exchangeName, meta.sharesOutstanding. Boerse und Aktienzahl allein beweisen keine Firmenidentitaet.`, '',
    'Wiederverwendung: wert-Entpackung und exakter Namensvergleich (namen.length === 1) aus probe-emittenten-zwillinge.js werden unveraendert per Quelltext-Extraktion ausgefuehrt. Leere Namen sind kein Identitaetsbeleg. (a) heisst gleiche CIK oder gleicher Name nach dieser Probe; der Namensteil bleibt eine Heuristik, kein Registerbeweis (Konfidenz fuer reale Firmenidentitaet nicht quantifizierbar).', '',
    'Die umfassendere issuerKeyLoose-/Milan-Logik des Zensus ist nur aus src/scoring/score.js bzw. filter-snapshot-merge.js importiert; diese Quellen liegen ausserhalb der erlaubten Lesegrenze. Sie wurde weder geladen noch nachgebaut. Reihen-Gleichheit selbst wird nicht als Firmenidentitaet verwendet: das waere bei dieser Fragestellung zirkulaer.', '',
    '(b) verlangt mindestens ein Paar mit verschiedenen gueltigen CIK, auch bei gleichem Namen. (c) gilt bei mindestens einem nicht entscheidbaren Paar und ohne (b)-Beleg. (a) verlangt ausschliesslich (a)-Paare. Diese Vorrangregel macht gemischte Gruppen disjunkt; Zeilenanteile sind Snapshot-Anteile, keine Firmenanteile.', '',
    row(['Klasse', 'Gruppen / alle Mehrfachgruppen', 'Zeilen / belastbare Snapshots', 'Paare / alle Paare in Mehrfachgruppen']), row(['---', '---', '---', '---']),
    ...['a', 'b', 'c'].map(k => row([k, count(totals[k].groups.length, g), count(totals[k].rows, r.reliable), count(r.pairs[k], pairTotal)])), '', summary, '',
    '## Alle Gruppen verschiedener Firmen (b)', '',
    'Jahreszahl = endliche gleiche Werte / alle Reihenpositionen; erster Jahreswert = erste gespeicherte Position, nicht das aelteste Jahr. Aktienzahlen und Umsatzwerte sind Feldwerte, keine Anteilszaehler.', '',
    row(['Gruppe', 'Ticker', 'Name', 'Boerse', 'CIK', 'sharesOutstanding', 'Gleiche Jahre / Positionen', 'Erster Jahreswert']), row(Array(8).fill('---')),
    ...totals.b.groups.flatMap((x, i) => x.members.map(s => row([`${i + 1}/${totals.b.groups.length}`, s.ticker, s.name, s.exchange, s.cik, s.shares, `${s.values.filter(Number.isFinite).length}/${s.values.length}`, s.values[0]]))),
    ...(totals.b.groups.length ? [] : [`Keine belegte Gruppe: ${count(0, g)} Mehrfachgruppen; fehlende CIK sind kein Beleg fuer Abwesenheit verschiedener Firmen.`]), '',
    '## AVB/VMRK und offene Befundgrenze', ''];
  for (const ticker of ['AVB', 'VMRK']) {
    const members = pop.snapshots.filter(s => s.ticker === ticker || s.file === ticker + '.json');
    lines.push(`${ticker}: ${count(members.length, n)} Snapshots; ` + (members.length ? members.map(s => `Name ${s.name}, CIK ${s.cik ?? 'fehlt'}, Reihe ${s.key}; Mehrfachgruppe ${r.groups.find(x => x.members.includes(s))?.kind ?? 'keine'}`).join('; ') : 'fehlt in dieser Population (Dateiname und meta.ticker geprueft).'), '');
  }
  lines.push('AVB/VMRK kann damit nicht als belegtes Paar in Tabelle (b) erscheinen. Ob dieser Fall ein Einzelfall oder eine Klasse verschiedener Firmen ist, bleibt mit dieser Population und ihren fehlenden Identifikatoren OFFEN. Die Gruppen-/Paarzaehlung ist reproduziert; eine gesicherte Emittentenanzahl ist daraus nicht ableitbar.', '',
    'Welche Zeile falsche Zahlen aus dem Roh-Feed traegt, bleibt offen und wurde nicht untersucht. Nur Befund, kein Fix ohne Orchestrator-Entscheid; keine Dedup-Regel und keine Empfehlung fuer eine richtige Zeile.', '',
    'Reproduktion: `node scripts/t178-reihen-zwillinge.js --population <POPULATION>`; Test: `node tests/t178-reihen-zwillinge.test.js`.', '',
    'Brief-Feedback: Die feste Population samt Sollhash macht die Messung eindeutig reproduzierbar. Fehlende CIK und die ausserhalb der Lesegrenze implementierte Emittentenlogik begrenzen den Identitaetsnachweis.', '');
  return lines.join('\n');
}

function main(args) {
  assert(args.length === 2 && args[0] === '--population' && args[1] && !args[1].startsWith('--'), 'Usage: --population <directory> is required');
  const rules = loadRules(), pop = readPopulation(args[1], rules);
  assert.equal(pop.digest, EXPECTED, 'Population SHA256 mismatch; report not written');
  const report = render(pop, measure(pop, rules), rules);
  fs.writeFileSync(REPORT, report, 'utf8');
  console.log('Population SHA256: ' + pop.digest);
  console.log(report.split('\n').find(x => x.startsWith('Zusammenfassung:')));
  console.log('Report written: ' + REPORT);
}

module.exports = { loadRules, canonical, readPopulation, measure, render, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
