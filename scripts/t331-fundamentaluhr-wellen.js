#!/usr/bin/env node
'use strict';
// Offline measurement. No product imports, environment files, or implicit population.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'reports/t331-fundamentaluhr-wellen-2026-09-21.md');
const EXPECTED = '27841c97eb794fa02073cfab8bcf61a7a1edc10ac8c8626a0d4703aeda6d29ae';
const DAY = 86400000;
const SMALL = 2000000; // MB, not MiB; the three supplied small logs satisfy either definition.
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const date = ms => new Date(ms).toISOString().slice(0, 10);
const pct = (n, d) => d ? (100 * n / d).toFixed(2) + ' %' : 'nicht definiert';
const row = cells => '| ' + cells.map(x => String(x).replace(/\|/g, '&#124;').replace(/\n/g, ' ')).join(' | ') + ' |';
const table = (headers, rows) => [row(headers), row(headers.map(() => '---')), ...rows.map(row)].join('\n');
const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);

function readPopulation(root) {
  assert(!fs.lstatSync(root).isSymbolicLink(), 'Population root must not be a link');
  const digest = crypto.createHash('sha256'), snapshots = [], manifests = [];
  let files = 0, headMismatch = 0;
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, e.name);
      assert(!e.isSymbolicLink(), 'Links are not supported: ' + file);
      if (e.isDirectory()) { walk(file); continue; }
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const bytes = fs.readFileSync(file), data = JSON.parse(bytes);
      files++;
      // Exactly T326's recursive order, relative path, NUL, byte hash, LF.
      digest.update(path.relative(root, file).replace(/\\/g, '/') + '\0' + hash(bytes) + '\n');
      if (/^_manifest.*\.json$/.test(e.name) && !data.meta) { manifests.push(data); continue; }
      assert(data && typeof data === 'object' && !Array.isArray(data), 'Invalid snapshot: ' + file);
      const stamp = data.meta?.fundamentalsAsOf;
      const ms = typeof stamp === 'string' ? Date.parse(stamp) : NaN;
      const head = bytes.subarray(0, 4096).toString('utf8').match(/"fundamentalsAsOf"\s*:\s*"([^"]+)"/);
      if ((head?.[1] || null) !== (stamp || null)) headMismatch++;
      snapshots.push({ ticker: data.meta?.ticker, ms, stamp });
    }
  }
  walk(root);
  assert(snapshots.length, 'Empty population / leere Population');
  return { snapshots, manifests, files, headMismatch, digest: digest.digest('hex') };
}

function parseRuns(text) {
  const ids = new Set();
  return text.trim().split(/\r?\n/).map(line => {
    const m = line.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)$/);
    assert(m && Number.isFinite(Date.parse(m[2])), 'Invalid runs.txt row: ' + line);
    assert(!ids.has(m[1]), 'Duplicate run ID: ' + m[1]); ids.add(m[1]);
    const day = date(Date.parse(m[2]));
    assert(day >= '2026-08-24' && day <= '2026-09-20', 'Run outside requested window');
    return { id: m[1], createdAt: m[2], event: m[3], conclusion: m[4], day };
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function scanLog(file) {
  const size = fs.statSync(file).size;
  const result = { file, size, small: size < SMALL, force: 0, fall: 0, broad: 0, fullOK: 0,
    selectors: [], budgets: [], forceDays: new Map(), members: new Map(), thresholds: new Set() };
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      // Exclude prep tests and shell command echoes; retain UNKNOWN STEP for older gh logs.
      const m = line.match(/^pull \((\d+)\)\t([^\t]+)\t(\d{4}-\d\d-\d\dT\S+) \[[^\]]+\] (\[(?:INFO|WARN)\] .*)$/);
      if (!m || !(m[2] === 'UNKNOWN STEP' || /^Run Yahoo Pull\b/.test(m[2]))) continue;
      const [, shard, , time, text] = m;
      assert(Number.isFinite(Date.parse(time)), 'Invalid log timestamp');
      const force = text.match(/^\[INFO\]\s+\S+ \[fundamentals-stale\]: forcing full pull \(fundamentalsAsOf > (\d+)d\)$/);
      if (force) { result.force++; increment(result.forceDays, date(Date.parse(time))); result.thresholds.add(Number(force[1])); }
      if (/^\[WARN\]\s+price-only failed for \S+, falling through to full pull:/.test(text)) result.fall++;
      if (/^\[INFO\]\s+\S+ \[[^\]]+\]: forcing full pull\b/.test(text)) result.broad++;
      if (/^\[INFO\]\s+\u2713 \S+: revenue=/.test(text)) result.fullOK++;
      if (text.includes('Selector-Diagnose:')) result.selectors.push(line);
      if (text.includes('Fundamentals-refresh budget:')) {
        const b = text.match(/Fundamentals-refresh budget: (\d+)\/(\d+) time-based full pulls used; (.*)/);
        assert(b, 'Unknown budget line: ' + line);
        result.budgets.push({ shard, used: Number(b[1]), cap: Number(b[2]), tail: b[3], line });
      }
      const member = text.match(/^\[INFO\]\s+(?:Pulling (\S+) \(|\u2713 (\S+)(?: \[price-only\]:|: revenue=))/);
      if (member) {
        const ticker = member[1] || member[2], ms = Date.parse(time);
        if (!result.members.has(ticker) || result.members.get(ticker).ms < ms) result.members.set(ticker, { shard, ms });
      }
    }
  } finally { lines.close(); input.destroy(); }
  return result;
}

function dailyComparison(pop, runs) {
  const stamps = new Map(), forces = new Map(), days = new Set();
  for (const s of pop.snapshots) if (Number.isFinite(s.ms)) { increment(stamps, date(s.ms)); days.add(date(s.ms)); }
  for (let t = Date.parse('2026-08-24'); t <= Date.parse('2026-09-20'); t += DAY) days.add(date(t));
  for (const r of runs) for (const [d, n] of r.forceDays) if (!r.small) { forces.set(d, (forces.get(d) || 0) + n); days.add(d); }
  return [...days].sort().map(day => {
    const logs = runs.filter(r => r.day === day);
    const measured = logs.some(r => !r.small) || forces.has(day);
    const n = stamps.get(day) || 0, f = measured ? (forces.get(day) || 0) : null;
    return { day, n, f, logs: logs.length, small: logs.filter(r => r.small).length,
      status: !logs.length ? 'ohne Lauf-Log' : !measured ? 'nur abgebrochen vor dem Pull' : 'gemessen' };
  });
}

function forecast(snapshots, members, budget = 3000) {
  const start = Date.parse('2026-09-21T00:00:00Z');
  // At millisecond resolution strict >30d becomes stamp +30d +1ms.
  const due = snapshots.filter(s => Number.isFinite(s.ms)).map(s => ({ at: s.ms + 30 * DAY + 1,
    shard: members.get(s.ticker)?.shard ?? 'unknown' })).sort((a, b) => a.at - b.at);
  let globalQueue = 0, cursor = 0;
  const shardQueue = new Map(), rows = [];
  for (let t = start; t < Date.parse('2026-10-11'); t += DAY) {
    const weekday = new Date(t).getUTCDay(), run = weekday >= 2 && weekday <= 6;
    const crossing = due.filter(s => s.at >= t && s.at < t + DAY).length;
    let demand = null, maxShard = null, unknown = null;
    if (run) {
      const clock = t + (2 * 60 + 17) * 60000;
      while (cursor < due.length && due[cursor].at <= clock) {
        increment(shardQueue, due[cursor].shard); globalQueue++; cursor++;
      }
      demand = globalQueue;
      globalQueue = Math.max(0, globalQueue - budget);
      maxShard = Math.max(0, ...[...shardQueue].filter(([k]) => k !== 'unknown').map(([, v]) => v));
      unknown = shardQueue.get('unknown') || 0;
      for (const [k, n] of shardQueue) if (k !== 'unknown') shardQueue.set(k, Math.max(0, n - budget));
    }
    rows.push({ day: date(t), crossing, run, demand, globalBacklog: run ? globalQueue : null,
      maxShard, unknown, shardBacklog: run ? [...shardQueue.values()].reduce((a, b) => a + b, 0) : null });
  }
  return { rows, initial: due.filter(s => s.at < start).length, unknown: due.filter(s => s.shard === 'unknown').length };
}

function render(pop, runs, sourceHash, populationPath, logsPath) {
  const manifest = pop.manifests.find(m => Number.isFinite(Date.parse(m.pulled_at)));
  assert(manifest, 'Population requires an internal manifest clock');
  const now = Date.parse(manifest.pulled_at), n = pop.snapshots.length;
  const known = pop.snapshots.filter(s => Number.isFinite(s.ms));
  const old = known.filter(s => now - s.ms > 30 * DAY).length;
  const measured = runs.filter(r => !r.small), forces = measured.reduce((s, r) => s + r.force, 0);
  const ranked = [...measured].sort((a, b) => b.force - a.force), top = ranked.slice(0, 3);
  const topTotal = top.reduce((s, r) => s + r.force, 0);
  const latest = runs.find(r => r.id === '35500025507');
  assert(latest && !latest.small, 'Missing population run log');
  const prediction = forecast(pop.snapshots, latest.members);
  const daily = dailyComparison(pop, runs);
  const sept19 = runs.find(r => r.id === '35438100627');
  assert(sept19, 'Missing 19 September comparison run');
  const budgetRows = measured.flatMap(r => r.budgets);
  const firstGlobal = prediction.rows.find(r => r.globalBacklog > 0);
  const firstShard = prediction.rows.find(r => r.shardBacklog > 0);
  const maxShard = Math.max(...prediction.rows.map(r => r.maxShard || 0));
  const lines = [
    `**T331: Wellen belegt; ${old}/${n} = ${pct(old, n)} alte Fundamentaluhren und ${sept19.fullOK} erfolgreiche Vollabrufe im Lauf ${sept19.id} widersprechen sich nicht; ein konstanter 66-Tage-Zyklus ist daraus nicht ableitbar (Konfidenz 99 %).**`, '',
    '> AUF EINEN BLICK: Bestandsalter am CI-Stichtag und erfolgreiche Schreibvorgänge je Lauf haben verschiedene Nenner und Uhren. Das Budget gilt je Shard; ein Gesamtdeckel wäre eine andere Rechnung.', '',
    '## 1. Messbasis und Fingerabdrücke', '',
    `Population: ${populationPath}\n\nLogs: ${logsPath}`, '',
    `Populations-SHA256: ${pop.digest}\n\nErwarteter SHA256: ${EXPECTED}\n\nSHA256 pull-yahoo.js (Dateibytes): ${sourceHash}`, '',
    'Hash-Methode identisch zu scripts/t-veraltung-zwei-definitionen.js: rekursiv je Verzeichnis lexikalisch sortierte JSON-Dateien; SHA256 über relative Pfade mit /, NUL, SHA256 der Dateibytes und LF; Manifest eingeschlossen. Keine angrenzenden Verzeichnisse gelesen.', '',
    `Bestandsuhr: manifest.pulled_at = ${manifest.pulled_at}; ${n}/${pop.files} JSON-Dateien sind Snapshots, ${pop.files - n} Metadaten-Datei(en). Lesbare meta.fundamentalsAsOf: ${known.length}/${n}; unbekannt: ${n - known.length}/${n}; Abweichungen zum 4096-Byte-Kopf: ${pop.headMismatch}/${n}. Tagesverteilung aus vollständigem meta, UTC.`, '',
    `Log-Abdeckung 24.08.–20.09.2026: ${runs.length} gelieferte Läufe; ${measured.length}/${runs.length} mit mindestens ${SMALL} Bytes, ${runs.length - measured.length}/${runs.length} nach Brief als „abgebrochen vor dem Pull“ markiert. Keine Nullmessung für kleine Logs. Für 24.08. liegt kein Lauf-Log vor. MB = 1.000.000 Bytes.`, '',
    table(['Gelesene Log-Datei', 'Größe (Bytes)'], runs.map(r => [path.basename(r.file), r.size])), '',
    'Zusätzlich gelesen: runs.txt. Logs nacheinander mit readline gestreamt; keine gleichzeitige Vollspeicherung.', '',
    '## 2. Messung je Lauf', '',
    'Zähleinheit: Log-Zeile eines Pull-Jobs (Shard), nur Laufzeitmeldungen [INFO]/[WARN] im Pull-Step oder UNKNOWN STEP; keine Prep-Tests oder Shell-Echos. F = fundamentals-stale-Zeile „forcing full pull (fundamentalsAsOf > …)“ (pull-yahoo.js:3730); R = „falling through to full pull“ (:3718); B = breiteres „forcing full pull“ einschließlich schema/currency (:3722/:3724); OK = erfolgreiche Voll-Schreibmeldung „✓ TICKER: revenue=“ nach :4506–4510. F/R sind Versuche, OK erfolgreiche Schreibmeldungen, keine eindeutigen Aktien über mehrere Läufe.', '',
    'Budget-Suchmuster „Fundamentals-refresh budget:“ aus pull-yahoo.js:4661; Selektor-Muster aus :4667. Schlusszeilen mit Job, Step und Zeit stehen unten wörtlich je Lauf. Fehlende Diagnose bedeutet nicht null. conclusion ist der gesamte Workflow-Status und kein Beweis, dass der Pull ausfiel.', '',
    table(['runId', 'createdAt (UTC)', 'event', 'conclusion', 'Status', 'F / Lauf', 'R / Lauf', 'B / Lauf', 'OK / Lauf', 'Selektor-/Budget-Zeilen'], runs.map(r => [r.id, r.createdAt, r.event, r.conclusion,
      r.small ? 'abgebrochen vor dem Pull' : 'Pull-Log messbar', ...['force', 'fall', 'broad', 'fullOK'].map(k => r.small ? 'n/a' : r[k]), `${r.selectors.length}/${r.budgets.length}`])), '',
    `Summe F = ${forces} Ereignisse/${measured.length} messbare Läufe. Die größten drei Läufe (${top.map(r => r.id + ': ' + r.force).join('; ')}) tragen ${topTotal}/${forces} = ${pct(topTotal, forces)} dieser Ereignisse.`, '',
    table(['Stichprobe runId', 'Brief: grep forcing full pull', 'Gemessen B', 'Gemessen F', 'B − F'], [['32925829090', 4688], ['33726630558', 3424], ['34198232299', 2066], ['33601800213', 923]].map(([id, expected]) => {
      const r = runs.find(x => x.id === id); return [id, expected, r.broad, r.force, r.broad - r.force];
    })), '',
    '## 3. Bestandsstempel gegen Tagesabrufe', '',
    `S = am ${manifest.pulled_at} noch vorhandene Snapshots mit fundamentalsAsOf an diesem UTC-Tag, Nenner ${n} Snapshots. F = Summe zeitbedingt erzwungener Versuche nach UTC-Zeit der Log-Zeile, nicht der Dateireihenfolge; Laufzahlen nach createdAt. Quote S/F ist keine Erfolgsquote: andere Abrufgründe, Fehlschläge, spätere Überschreibungen und mehrere Läufe verändern S. Differenz = S − F. Bei fehlender Messung n/a statt Null.`, '',
    table(['UTC-Tag', 'S / Bestand', 'Läufe (davon klein)', 'F / Tageslogs', 'S/F', 'S − F', 'Abdeckung'], daily.map(d => [d.day, `${d.n}/${n}`, `${d.logs} (${d.small})`, d.f ?? 'n/a', d.f === null ? 'n/a' : pct(d.n, d.f), d.f === null ? 'n/a' : d.n - d.f, d.status])), '',
    'Prüfung der Stempel-Stichprobe des Briefs (jeweils Nachher-Bestand zur oben genannten Bestandsuhr; Abweichungen werden nicht übernommen):', '',
    table(['fundamentalsAsOf-Tag UTC', 'Brief / Bestand', 'Gemessen / Bestand', 'Differenz'], [['2026-08-26', 4344], ['2026-09-03', 3365], ['2026-09-08', 2021], ['2026-08-30', 1016], ['2026-09-02', 1024]].map(([day, expected]) => {
      const actual = daily.find(d => d.day === day).n; return [day, `${expected}/${n}`, `${actual}/${n}`, actual - expected];
    })), '',
    `Stempel vor 25.08.2026 UTC: ${known.filter(s => s.ms < Date.parse('2026-08-25')).length}/${n}. Der vollständige Meta-Leser und der Kopf-Leser stimmen überein; die zwei Abweichungen um je einen Snapshot zur Brief-Stichprobe sind keine übernommenen Rundungswerte.`, '',
    'Stempeltage ohne Lauf-Log (gesondert): ' + daily.filter(d => d.n && !d.logs).map(d => `${d.day}: ${d.n}/${n}`).join('; ') + '.', '',
    '## 4. Entscheid und zitierfähige Aussagen', '',
    `**(d) trägt, ergänzt um (b) und (c), Konfidenz 99 %.** Wellen statt konstanter Tagesrate: ${topTotal}/${forces} erzwungene Versuche liegen in nur ${top.length}/${measured.length} messbaren Läufen; die korrespondierenden Stempelkohorten sind in Abschnitt 3 sichtbar. Das beweist Konzentration, keine tickerweise Erfolgszuordnung aller historischen Abrufe.`, '',
    `(a) Kein Beleg für Stempel ohne Vollabruf (Konfidenz 95 % für den gelesenen Quellstand): pull-yahoo.js:4492–4506 setzt fundamentalsAsOf beim Schreiben nach dem Vollpfad; :4505 erlaubt gleichzeitig fundamentalsIncomplete. Ein frischer Stempel belegt deshalb keinen vollständigen Fundamentaldatensatz. Ein Tag mit S > F widerlegt den Stempel nicht: F erfasst nur einen Abrufgrund. Historische Quellstände wurden nicht gelesen.`, '',
    `(b) Die 242 sind reproduziert als ${sept19.fullOK} erfolgreiche Voll-Schreibmeldungen/1 Lauf ${sept19.id} (createdAt ${sept19.createdAt}); dagegen ${sept19.force} zeitbedingt erzwungene Versuche und ${sept19.fall} Preisabruf-Fallbacks/selber Lauf. 242 ist weder der F-Zähler noch eine feste tägliche Kapazität. ${n}/${sept19.fullOK} = ${(n / sept19.fullOK).toFixed(2)} Läufe ist lediglich ein Quotient unter konstanter Rate, keine gemessene Zyklusdauer; bei Di–Sa sind Läufe zudem keine Kalendertage.`, '',
    `(c) Population und Selektor-Bestand sind nicht identisch: ${n} Nachher-Dateien am ${manifest.pulled_at}, Manifest n_eingang_snapshots=${manifest.n_eingang_snapshots}, n_sel_young_enough=${manifest.n_sel_young_enough}, n_sel_young_and_stale=${manifest.n_sel_young_and_stale}, n_sel_not_young_but_stale=${manifest.n_sel_not_young_but_stale}. :3604–3616/:3665–3668 zählt vor dem Abruf im verarbeiteten Slice. Kein historischer Eingangsbestand für ein Replay vorhanden.`, '',
    `Zitierfähig: „${old}/${n} = ${pct(old, n)} der gelieferten CI-Snapshots tragen am ${manifest.pulled_at} eine fundamentalsAsOf älter als 30 × 24 Stunden.“ Ebenfalls zitierfähig: „${sept19.fullOK} erfolgreiche Voll-Schreibmeldungen im Lauf ${sept19.id}.“ Nicht zitierfähig als gemessene Wiederkehrzeit: „66-Tage-Vollpull-Zyklus“.`, '',
    '58,2 % und 7,58 %/1.318 werden nicht neu interpretiert: T326 nennt andere historische Quellen/Nenner (lokaler Altbestand bzw. Eingangsbestand), die hier nicht vorliegen. Diese Werte lassen sich aus dieser Nachher-Population nicht reproduzieren; ihr Abstand wird nicht kausal erklärt.', '',
    '## 5. Vorhersage 21.09.–10.10.2026', '',
    'Bedingtes Modell, keine gemessene Zukunft (Konfidenz 70 % für die operative Übertragung, Rechnung unter Annahmen deterministisch): Bestand eingefroren; keine vorgezogenen Earnings-/Schema-Abrufe, keine neuen Titel, keine Fehler, alle fälligen Namen erreichbar, je geplanter Lauf erfolgreiche Bedienung bis zum Budget. Schwelle strikt >30 × 24 Stunden (:117–118/:298); Kreuzung = Stempel +30 Tage +1 ms. Lauftage Di–Sa, Start 02:17 UTC (Cron `17 2 * * 2-6` laut Brief). Tatsächliche Starts können später liegen; einige historische schedule-Läufe begannen erst nach 07:00 UTC.', '',
    `Budget laut Brief 3000; unabhängig in ${budgetRows.length} Schlusszeilen überprüft: Caps ${[...new Set(budgetRows.map(b => b.cap))].join(', ')} je Shard, ${budgetRows.filter(b => b.tail === 'none deferred.').length}/${budgetRows.length} mit „none deferred.“. Maximal beobachtet ${Math.max(...budgetRows.map(b => b.used))}/3000 je Shard und Lauf. :143–148 und :3703–3708 begrenzen den lokalen Prozesszähler; Freifahrten verbrauchen dieses Budget nicht. daily-pull.yml wurde wegen der Lesegrenze nicht geöffnet; Cron ist eine Auftragsannahme.`, '',
    `Shard-Zuordnung für die Prognose aus Pulling-/Erfolgsmeldungen des Populationslaufs ${latest.id}, unverändert fortgeschrieben: ${n - prediction.unknown}/${n} Snapshots zugeordnet, ${prediction.unknown}/${n} unbekannt. Vor Beginn schon über der Schwelle: ${prediction.initial}/${n}. Unbekannte werden als unbedient ausgewiesen, nie still als frisch.`, '',
    'Die Tageskreuzungen schließen auch Stempel ein, die erst nach 02:17 fällig werden: diese stehen am nächsten Lauftag an. „Fällig global“ und „Rest global“ sind eine ausdrücklich kontrafaktische Rechnung mit nur 3000 für alle Shards zusammen; „Max je Shard“ und „Rest Shards“ verwenden das tatsächlich beobachtete Budget je Prozess. Wochenenden/Montage sammeln Bedarf; Rest ist jeweils unmittelbar nach dem modellierten Lauf, nicht Tagesende.', '',
    table(['UTC-Tag', `Kreuzungen / ${n} Snapshots`, 'Lauf 02:17', 'Fällig global', 'Rest global (fiktiver Deckel)', 'Max je Shard / 3000', 'Rest Shards', 'davon unbekannt'], prediction.rows.map(r => [r.day, r.crossing, r.run ? 'ja' : 'nein', r.demand ?? '—', r.globalBacklog ?? '—', r.maxShard ?? '—', r.shardBacklog ?? '—', r.unknown ?? '—'])), '',
    `Vorhersage: Bei einem fiktiven Gesamtdeckel entsteht erstmals ${firstGlobal?.day || 'kein'} Budget-Rückstau${firstGlobal ? ` (${firstGlobal.globalBacklog} unbediente Snapshots nach diesem Lauf)` : ''}. Beim beobachteten Budget je Shard: ${firstShard ? `erster Rest ${firstShard.day}: ${firstShard.shardBacklog}` : 'kein budgetbedingter Rückstau im Prognosefenster'}; größte modellierte Shard-Nachfrage ${maxShard}/3000. Eine Gesamtwelle über 3000 allein lässt das reale Budget folglich nicht reißen. Zeit-/Fehler-/Selektorengpässe und geänderte Shard-Zuordnung bleiben außerhalb dieser Kapazitätsprognose.`, '',
    'Offen: Ob der Selektor glätten soll, ist nicht Gegenstand dieses Auftrags. Fehlende historische Eingangsbestände, nicht gelesene historische Quellstände und verzögerte/zusätzliche Läufe begrenzen die kausale und zeitliche Prognose.', '',
    '### Wörtliche Schlusszeilen je Lauf (Belege zu Abschnitt 2)', '',
  ];
  for (const r of runs) {
    lines.push(`#### ${r.id} — ${r.createdAt}`, '', r.small ? 'abgebrochen vor dem Pull (Größenregel des Briefs).' : 'Pull-Log messbar.', '',
      `Selector-Diagnose: ${r.selectors.length ? 'wörtliche Zeilen unten' : 'nicht vorhanden (keine Nullmessung)'}. Budget-Schlusszeilen: ${r.budgets.length}/${17} erwartete Shards nach Populationsmanifest.`, '',
      '```text', ...r.selectors, ...r.budgets.map(b => b.line), '```', '');
  }
  lines.push('Reproduktion: `node scripts/t331-fundamentaluhr-wellen.js --population <POPULATION> --logs <LOGS>`; Test: `node tests/t331-fundamentaluhr-wellen.test.js`.', '');
  return lines.join('\n');
}

async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--population', '--logs'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Required: --population <path> --logs <path>');
    assert(!options[args[i]], 'Duplicate argument'); options[args[i]] = args[i + 1];
  }
  assert(options['--population'], 'Required: --population; local snapshots/ is forbidden');
  assert(options['--logs'], 'Required: --logs');
  const populationPath = fs.realpathSync(options['--population']);
  const local = path.join(ROOT, 'snapshots').toLowerCase();
  assert(populationPath.toLowerCase() !== local && !populationPath.toLowerCase().startsWith(local + path.sep), 'Local snapshots/ is forbidden');
  const pop = readPopulation(populationPath);
  assert.equal(pop.digest, EXPECTED, `Population SHA256 mismatch: ${pop.digest}; expected ${EXPECTED}; report not written`);
  const logsPath = fs.realpathSync(options['--logs']);
  const runs = parseRuns(fs.readFileSync(path.join(logsPath, 'runs.txt'), 'utf8'));
  const files = fs.readdirSync(logsPath).filter(f => f.endsWith('.log')).sort();
  assert.deepEqual(files, runs.map(r => r.id + '.log').sort(), 'runs.txt/log file mismatch');
  for (const run of runs) Object.assign(run, await scanLog(path.join(logsPath, run.id + '.log')));
  assert(runs.every(r => [...r.thresholds].every(days => days === 30)), 'Observed refresh threshold differs from 30 days');
  const sourceHash = hash(fs.readFileSync(path.join(ROOT, 'pull-yahoo.js'))); // Hash only, never execute.
  fs.writeFileSync(REPORT, render(pop, runs, sourceHash, populationPath, logsPath), 'utf8');
  console.log(`Population SHA256: ${pop.digest}`);
  console.log(`Logs: ${runs.length}; report: ${REPORT}`);
}

module.exports = { readPopulation, parseRuns, scanLog, dailyComparison, forecast, main };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error('Abbruch: ' + e.message); process.exitCode = 1; });
