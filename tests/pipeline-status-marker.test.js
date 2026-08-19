'use strict';
/**
 * tests/pipeline-status-marker.test.js — Waechter fuer den Lauf-Statusmarker
 * (outputs/pipeline-status/v1/latest.json, Vertrag `screener-pipeline-status/v1`).
 *
 * WOZU. Vier rote Nachtlaeufe vom 12.–15.08.2026 blieben unsichtbar: Karls Boards
 * standen vier Tage auf dem Stand vom 09.08., das Cockpit zeigte die alten Raenge
 * stillschweigend weiter. findash hat die rote Warnleiste, aber niemand publizierte den
 * Marker, an dem sie haengt. Der Job `laufstatus` in daily-pull.yml schliesst die Luecke.
 *
 * WARUM DIESER TEST. Ein Publikationsschritt ohne Kontrolle ist die naechste stille
 * Stelle — und am 16.08. sind in beiden Repos SECHS gruen-tote Waechter aufgefallen,
 * einer davon ausgerechnet in dieser Warnleiste. Vier Ausfaelle muessen hier auffliegen:
 *
 *   (1) Der Marker wird gar nicht erzeugt.
 *   (2) Er wird erzeugt, aber NICHT deployt — der haeufigste Fall bei rotem Lauf, weil
 *       beide bestehenden gh-pages-Deploys `if: success()` tragen. Genau der Fall zaehlt.
 *   (3) Er wird deployt, verletzt aber den Vertrag, den findash prueft (drueben wird der
 *       Marker dann komplett verworfen: keine Warnleiste, dafuer eine Vertragsmeldung).
 *   (4) last_success_at wird bei rotem Lauf faelschlich ueberschrieben — dann behauptet
 *       das Banner, die Raenge seien von heute.
 *
 * BAUART wie tests/t564-datenkanal.test.js: am OBJEKT geprueft (benannter Job, benannter
 * Schritt), Anwesenheit UND Abwesenheit, und das VERHALTEN wird gefahren statt nachgebaut
 * — die run-Bloecke werden aus der Workflow-Datei geschnitten und per `sh` ausgefuehrt.
 * Ein Nachbau wuerde genau die Abweichung nicht finden, um die es geht.
 *
 * ENDE-ZU-ENDE. Der Kern-Beweis ist kein JSON-Vergleich: ein simuliert ROTER Lauf faehrt
 * die echten Schritte "Statusmarker schreiben" und "Statusmarker nach gh-pages
 * veroeffentlichen" gegen ein LOKALES bare-Repo als Ersatz-gh-pages. Geprueft wird
 * danach, was auf dem gh-pages-Zweig ANGEKOMMEN ist. Damit faellt (2) auf, was ein
 * reiner Funktionstest nie sehen wuerde.
 *
 * GRENZE, benannt statt verschwiegen: der Schritt "Vorgaenger-Marker von gh-pages holen"
 * wird nur in seinem Ausfall-Zweig gefahren (nicht erreichbare URL). Sein Erfolgsfall
 * braucht einen HTTP-Server; die Schnittstelle zu den Folgeschritten ist die Datei
 * _vorgaenger.json auf der Platte, und die legt der Ende-zu-Ende-Test direkt.
 *
 * Run: node tests/pipeline-status-marker.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8')
  .replace(/\r\n/g, '\n');
const { validateMarker, JOB_REIHENFOLGE } = require('../scripts/pipeline-status.js');

const MARKER_REL = 'outputs/pipeline-status/v1/latest.json';
// Vorwaerts-Schraegstriche: der Pfad wandert in einen `sh -c`-Block, und Backslashes
// waeren dort Escape-Zeichen.
const SKRIPT = path.join(ROOT, 'scripts', 'pipeline-status.js').replace(/\\/g, '/');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Den Rumpf EINES benannten Workflow-Schritts schneiden (Bauart aus t564, T568-F8). */
function schritt(text, startMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + startMarker);
  const alle = text.slice(s).split('\n');
  const zeilen = [alle[0]];
  for (let i = 1; i < alle.length; i++) {
    if (/^ {6}- /.test(alle[i]) || /^ {0,5}\S/.test(alle[i])) break;
    zeilen.push(alle[i]);
  }
  while (zeilen.length && /^\s*(#.*)?$/.test(zeilen[zeilen.length - 1])) zeilen.pop();
  return zeilen.join('\n');
}

/** Den Rumpf EINES benannten Jobs schneiden. */
function job(text, name) {
  const kopf = '\n  ' + name + ':\n';
  const s = text.indexOf(kopf);
  assert.ok(s >= 0, 'Job nicht gefunden: ' + name);
  const alle = text.slice(s + 1).split('\n');
  const zeilen = [alle[0]];
  for (let i = 1; i < alle.length; i++) {
    if (/^ {0,2}\S/.test(alle[i])) break;
    zeilen.push(alle[i]);
  }
  return zeilen.join('\n');
}

/** Alle Job-IDs der Workflow-Datei (Zeilen der Form `  <name>:`). */
function alleJobs(text) {
  const ab = text.indexOf('\njobs:\n');
  assert.ok(ab >= 0, 'kein jobs:-Block gefunden');
  return text.slice(ab).split('\n')
    .filter((z) => /^ {2}[a-z0-9][a-z0-9-]*:$/.test(z))
    .map((z) => z.trim().replace(/:$/, ''));
}

/** Den `run: |`-Block eines Schritts als ausfuehrbaren Shell-Text (10 Leerzeichen Einzug). */
function runBlock(section) {
  const i = section.indexOf('run: |');
  assert.ok(i >= 0, 'kein `run: |` im Schritt');
  return section.slice(i + 'run: |'.length).split('\n').map((z) => z.replace(/^ {10}/, '')).join('\n');
}

/** Eine ausfuehrbare `bash` finden (Linux/CI: auf PATH; Windows: die von Git). */
function bashBinaer() {
  const kandidaten = ['bash', 'C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe'];
  for (const k of kandidaten) {
    try { execFileSync(k, ['-c', 'exit 0'], { stdio: 'ignore' }); return k; } catch (e) { /* naechster */ }
  }
  return assert.fail('keine ausfuehrbare bash gefunden — dieser Waechter kann das Verhalten der '
    + 'Publikations-Schritte dann nicht messen. Ein stiller Skip waere hier der schlimmste '
    + 'Ausgang: die Wache saehe aus wie bestanden.');
}

// WARUM `bash -eo pipefail` UND NICHT `sh -c` (Review 16.08., der wichtigere der beiden Funde).
// Der Runner faehrt `run:`-Bloecke mit errexit — diese Datei setzt weder `defaults:` noch
// `shell:`, also gilt GitHubs Vorgabe `bash -e {0}`. Der Harness lief bis hierher als `sh -c`
// GANZ OHNE errexit und war damit strukturell blind fuer jede Regression, deren Sichtbarkeit
// an errexit haengt — also fuer genau die Klasse, die der Tag-972-Fix betraf.
// Gemessen, nicht abgeleitet: ein ungeschuetztes `false` mitten im Block endet unter `sh` mit
// 0 und unter `bash -e` mit 1.
// `pipefail` ist zusaetzlich und heute ein No-Op (die Bloecke enthalten keine Pipes). Es bleibt
// bewusst drin: sollte jemand spaeter `shell: bash` setzen (dann gilt drueben `-eo pipefail`)
// oder eine Pipe einbauen, ist der Harness eher zu streng als zu lasch. Falsch-rot faellt auf,
// falsch-gruen nicht.
function sh(block, { cwd, env }) {
  try {
    const out = execFileSync(bashBinaer(), ['-eo', 'pipefail', '-c', block],
      { cwd, encoding: 'utf8', env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const git = (args, cwd) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// ── Der Job selbst: laeuft immer, blockiert nichts, ist nicht entschaerft ─────────────
const laufstatus = job(daily, 'laufstatus');

test('Job: `if: always()` — sonst meldet er nicht, wenn es etwas zu melden gibt', () => {
  assert.match(laufstatus, /^ {4}if:\s*always\(\)\s*$/m,
    'der laufstatus-Job traegt kein job-eigenes `if: always()`. Ohne es laeuft er bei rotem Lauf '
    + 'gar nicht — und der rote Lauf ist der EINZIGE Fall, der zaehlt.');
});

test('Job: haengt an ALLEN uebrigen Jobs (ein fehlender ist ein blinder Fleck)', () => {
  const jobs = alleJobs(daily);
  assert.ok(jobs.includes('laufstatus'), 'laufstatus fehlt in der Job-Liste — der Sucher greift nicht');
  const erwartet = jobs.filter((j) => j !== 'laufstatus');
  const m = /^ {4}needs:\s*\[([^\]]+)\]\s*$/m.exec(laufstatus);
  assert.ok(m, 'der laufstatus-Job hat keine needs-Liste in [a, b]-Form');
  const hat = m[1].split(',').map((s) => s.trim());
  for (const j of erwartet) {
    assert.ok(hat.includes(j),
      `Job "${j}" fehlt im needs: des laufstatus-Jobs. Sein Ausfall taucht dann im Statusmarker `
      + 'nie auf — der Lauf ist rot, das Banner schweigt.');
  }
  assert.deepEqual(hat.slice().sort(), erwartet.slice().sort(),
    'needs: und die Job-Liste der Datei stimmen nicht ueberein.');
});

test('Job: NIEMAND haengt an laufstatus (er darf nichts blockieren)', () => {
  const needsZeilen = daily.split('\n').filter((z) => /^ {4}needs:/.test(z));
  assert.ok(needsZeilen.length >= 5, 'zu wenige needs-Zeilen gefunden (' + needsZeilen.length
    + ') — der Sucher greift nicht mehr, die Zusicherung waere leer.');
  for (const z of needsZeilen) {
    assert.ok(!z.includes('laufstatus'),
      'ein Job haengt am laufstatus-Job ("' + z.trim() + '") — dann reisst dessen rotes X fremde '
      + 'Jobs mit, und der Statusmarker kostet Datenschritte.');
  }
});

test('Job: nicht per continue-on-error entschaerft', () => {
  assert.ok(!/^\s*continue-on-error\s*:/m.test(laufstatus),
    'continue-on-error macht die ::error::-Meldungen wirkungslos — Karls anderer Kanal ist das rote X.');
});

// ── (1)+(2) Die Publikation: sie muss AUCH BEI ROTEM LAUF laufen ─────────────────────
const schreibSchritt = schritt(daily, 'name: Statusmarker schreiben');
const publishSchritt = schritt(daily, 'name: Statusmarker nach gh-pages veroeffentlichen (auch bei rotem Lauf)');

test('(2) beide Schritte tragen `if: always()` und NICHT `if: success()`', () => {
  for (const [wie, s] of [['Statusmarker schreiben', schreibSchritt], ['Veroeffentlichen', publishSchritt]]) {
    assert.match(s, /^ {8}if:\s*always\(\)\s*$/m,
      `der Schritt "${wie}" traegt kein \`if: always()\`. Ein vorher gefallener Schritt liesse ihn `
      + 'ausfallen — der Marker ginge bei rotem Lauf nicht raus.');
    assert.ok(!/^ {8}if:\s*success\(\)/m.test(s),
      `der Schritt "${wie}" ist auf success() gegatet — genau der Fehler der beiden bestehenden `
      + 'gh-pages-Deploys, die deshalb bei rotem Lauf schweigen.');
  }
});

test('(2) der Publish-Schritt pusht selbst (kein Mitfahren auf einem success()-Deploy)', () => {
  assert.match(publishSchritt, /git push --force origin gh-pages/,
    'der Publish-Schritt pusht nicht selbst nach gh-pages.');
  assert.match(publishSchritt, /git clone --depth 1 --branch gh-pages/,
    'der Publish-Schritt klont gh-pages nicht selbst.');
});

test('(1) ein NICHT erzeugter Marker bricht den Publish-Schritt (kein stiller Ueberspringer)', () => {
  const i = publishSchritt.indexOf('if [ ! -f "$rel" ]');
  assert.ok(i >= 0, 'keine Existenzpruefung der deklarierten Marker vor dem Klonen — ein nicht '
    + 'erzeugter Marker liefe still durch.');
  const fenster = publishSchritt.slice(i, publishSchritt.indexOf('rm -rf _ghp_status'));
  assert.match(fenster, /::error::/, 'der fehlende Marker meldet sich nicht in Karls Kanal');
  assert.match(fenster, /exit 1/, 'der fehlende Marker macht den Schritt nicht rot');
});

test('(2) "kein Diff" ist ein FEHLER, kein gruener Ausstieg', () => {
  const i = publishSchritt.indexOf('if git diff --staged --quiet; then');
  assert.ok(i >= 0, 'keine Diff-Pruefung im Publish-Schritt');
  const fenster = publishSchritt.slice(i, publishSchritt.indexOf('git commit -m', i));
  assert.match(fenster, /::error::/,
    'der "kein Diff"-Zweig meldet nichts. completed_at wird bei jedem Lauf neu gestempelt — '
    + '"kein Diff" kann nur heissen, dass die Kopie nicht angekommen ist. Ein `exit 0` waere hier '
    + 'ein gruener Haken auf einen nicht publizierten Alarm.');
  assert.ok(!/exit 0/.test(fenster),
    'der "kein Diff"-Zweig steigt gruen aus — der schlimmste Ausgang: Deploy-Job gruen, kein Deploy.');
});

test('(2) die Kopie wird gegen die Quelle verglichen (T568-F4: Existenz genuegt nicht)', () => {
  const iCp = publishSchritt.indexOf('cp "../$rel" "$rel"');
  assert.ok(iCp >= 0, 'die Marker-Kopie fehlt in der Retry-Schleife');
  const iCmp = publishSchritt.indexOf('cmp -s "../$rel" "$rel"', iCp);
  const iAdd = publishSchritt.indexOf('git add $MARKER_PFADE', iCmp);
  assert.ok(iCmp > iCp, 'nach dem cp steht kein Inhalts-Vergleich — im gh-pages-Klon liegt der '
    + 'Marker von GESTERN, eine blosse Existenzpruefung waere ein No-Op.');
  assert.ok(iAdd > iCmp, 'kein "git add $MARKER_PFADE" nach der Pruefung — ohne diesen Anker liefe '
    + 'das Pruef-Fenster bis zum Ende und eine Pruefung HINTER dem Push bliebe gruen.');
  const fenster = publishSchritt.slice(iCmp, iAdd);
  assert.match(fenster, /::error::/, 'der Vergleich meldet sich nicht in Karls Kanal');
  assert.match(fenster, /exit 1/, 'der Vergleich macht den Schritt nicht rot');
});

test('(2) gezieltes git add, nie -A (L17)', () => {
  assert.ok(!/git add -A/.test(publishSchritt),
    'der Publish-Schritt addet -A und nimmt damit alles im Baum mit — er darf ausschliesslich die '
    + 'deklarierten Marker veroeffentlichen.');
});

test('Fetch+Reset ist der ERSTE Befehl jedes Versuchs (T564-B2, Positiv-Pin)', () => {
  const lines = publishSchritt.split('\n');
  const body = [];
  let started = false;
  for (const line of lines) {
    if (!started) { if (line.includes('for i in 1 2 3; do')) started = true; continue; }
    if (line.trim() === 'done') break;
    body.push(line);
  }
  assert.ok(started, 'keine Retry-Schleife im Publish-Schritt');
  const erste = body.map((z) => z.trim()).find((t) => t !== '' && !t.startsWith('#')) || '';
  assert.match(erste, /^(if\s+!?\s*)?git fetch origin gh-pages\b/,
    'der Schleifenkoerper beginnt mit "' + erste + '" statt mit dem Fetch. Dieser Job laeuft als '
    + 'letzter im Lauf; ein parallel laufender Lauf haette zwischenzeitlich deployt, und der '
    + '--force-Push rollte dessen Stand zurueck.');
});

// ── Die Marker-Liste bleibt der eine Andockpunkt fuer einen zweiten Marker ────────────
test('MARKER_PFADE deklariert den Pfad, den findash abruft', () => {
  const m = /^ {10}MARKER_PFADE:\s*(.+)$/m.exec(publishSchritt);
  assert.ok(m, 'keine MARKER_PFADE-Liste im Publish-Schritt');
  assert.ok(m[1].trim().split(/\s+/).includes(MARKER_REL),
    `MARKER_PFADE enthaelt "${MARKER_REL}" nicht. findash holt genau diesen Pfad von gh-pages `
    + '(data-layer/screener-sync.js) — jeder andere Ort ist fuer die Warnleiste unsichtbar.');
});

// Review 16.08.: der Selftest (schaerfste Pruefbatterie — jede Einzelregel des Vertrags,
// die Fortschreibung von last_success_at, Drift in beide Richtungen) lief in KEINEM Job und
// war damit nur bei manuellem Aufruf wirksam. Eine punktuelle Schwaechung einer
// Validator-Regel haette kein CI-Lauf gefangen. Am Objekt gepinnt: der Schritt liegt im
// prep-Job (dort, wo die beiden Nachbar-Selftests schon stehen) und ist nicht entschaerft.
test('der Statusmarker-Selftest laeuft im prep-Job (nicht nur von Hand)', () => {
  const prep = job(daily, 'prep');
  assert.match(prep, /run:\s*node scripts\/pipeline-status\.js --selftest/,
    'der Vertrags-Selftest steht in keinem CI-Schritt des prep-Jobs — eine geschwaechte '
    + 'Validator-Regel faellt dann nirgends auf, und der Marker kann vertragswidrig rausgehen, '
    + 'ohne dass ein Lauf rot wird.');
  const s = schritt(daily, 'name: Statusmarker Contract Selftest');
  assert.ok(!/continue-on-error/.test(s),
    'continue-on-error am Selftest macht ihn wirkungslos.');
});

test('Runner-Scratch des Jobs steht in .gitignore (T564-B4, gleiche Hygiene)', () => {
  const zeilen = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    .replace(/\r\n/g, '\n').split('\n').map((z) => z.trim());
  for (const eintrag of ['_ghp_status/', '_vorgaenger.json']) {
    assert.ok(zeilen.includes(eintrag),
      eintrag + ' fehlt in .gitignore — Runner-Scratch des laufstatus-Jobs gehoert nie ins Repo.');
  }
});

// ── Drift: die Job-Liste des Skripts muss die des Workflows sein ─────────────────────
test('JOB_REIHENFOLGE deckt genau die Jobs des Tageslaufs ab (Mengen-Pin gegen die Datei)', () => {
  const erwartet = alleJobs(daily).filter((j) => j !== 'laufstatus');
  assert.deepEqual(JOB_REIHENFOLGE.slice().sort(), erwartet.slice().sort(),
    'die Job-Liste in scripts/pipeline-status.js weicht von der Workflow-Datei ab — ein Job faellt '
    + 'still aus der Statusmeldung oder das Skript bricht zur Laufzeit. Ist: ' + JOB_REIHENFOLGE.join(',')
    + ' | Workflow: ' + erwartet.join(','));
});

// Review 16.08.: der Mengen-Pin darueber sortiert VOR dem Vergleich — er sieht eine
// Vertauschung nicht, obwohl genau die Reihenfolge bestimmt, WELCHER Job als Ursache
// gemeldet wird. Sie kann nicht gegen die Datei-Reihenfolge geprueft werden, weil sie
// bewusst davon abweicht (Kettenglieder zuerst, nicht-blockierende Waechter dahinter).
// Also hier ausgeschrieben: wer sie aendert, aendert die Ursachen-Meldung und muss diese
// Zeile mitaendern.
test('JOB_REIHENFOLGE ist GENAU diese Prioritaet (sie bestimmt failed_job)', () => {
  // 18.08.: 'prices' dazu. Die SACHE hat sich geaendert, nicht nur der Code — der Kursabruf
  // ist vom Schritt zum eigenen Job geworden. Er steht zwischen pull und merge, weil er ein
  // Daten-Kettenglied ist; die Regel "Kettenglieder vor Diagnose-Waechtern" bleibt unberuehrt.
  assert.deepEqual(JOB_REIHENFOLGE,
    ['prep', 'pull', 'prices', 'merge', 'scoring', 'entdeckungs-waechter', 'earnings-transport-waechter'],
    'die Prioritaets-Reihenfolge hat sich geaendert. Sie entscheidet, welcher Job im Banner als '
    + 'Ursache steht: die fuenf Kettenglieder zuerst, die zwei nicht-blockierenden Diagnose-'
    + 'Waechter dahinter. Steht ein Waechter vorn, meldet der Marker bei einem Doppelausfall den '
    + 'Diagnose-Job statt des Datenschritts — Karl sucht am falschen Job.');
});

// ── Der Vorgaenger-Abruf darf den Marker nie verhindern ──────────────────────────────
test('ein nicht erreichbarer Vorgaenger warnt, verhindert den Marker aber NICHT', () => {
  const block = runBlock(schritt(daily, 'name: Vorgaenger-Marker von gh-pages holen'))
    .replace(/^url=".*"$/m, 'url="file:///gibtesnicht/kein-marker.json"');
  assert.ok(block.includes('file:///gibtesnicht'), 'die URL-Ersetzung hat nicht getroffen — dieser '
    + 'Test misst dann etwas anderes als den Ausfall-Zweig.');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-fetch-'));
  const r = sh(block, { cwd });
  assert.equal(r.code, 0, 'ein gescheiterter Vorgaenger-Abruf bricht den Schritt ab (exit ' + r.code
    + ') — dann geht bei genau dem Netzproblem gar kein Marker raus. Ein Banner ohne Datum ist '
    + 'unendlich viel besser als kein Banner. Ausgabe: ' + r.out.trim());
  assert.match(r.out, /::warning::/, 'der Ausfall meldet sich gar nicht — der letzte Erfolgszeitpunkt '
    + 'geht dann still verloren.');
  assert.ok(!fs.existsSync(path.join(cwd, '_vorgaenger.json')),
    'ein halb geschriebener/leerer _vorgaenger.json bleibt liegen — der Folgeschritt liest ihn und '
    + 'erbt Muell statt ehrlich leer zu bleiben.');
});

// ══ ENDE-ZU-ENDE: simuliert roter Lauf -> vertragsgueltiger Marker LIEGT auf gh-pages ══
//
// Kein Funktionstest: die echten run-Bloecke aus daily-pull.yml werden gegen ein lokales
// bare-Repo als Ersatz-gh-pages gefahren. Geprueft wird, was auf dem Zweig ANGEKOMMEN ist.
const SHA = 'f'.repeat(40);

/**
 * @param {object} o
 * @param {object} o.needs        simulierter needs-Kontext
 * @param {string|null} o.vorgaenger  Inhalt von _vorgaenger.json (null = keiner)
 * @param {boolean} o.mitGhPages  hat das Ersatz-Remote schon einen gh-pages-Zweig?
 * @param {string} [o.veroeffentlichen]  Wert der Zweig-Wache; 'true' = Lauf auf main (Vorgabe),
 *   'false' = Lauf auf einem Feature-Zweig oder mit gesetztem nur_rechnen-Ventil.
 *   IMMER explizit gesetzt, nie aus process.env geerbt: im CI traegt der Lauf selbst ein
 *   VEROEFFENTLICHEN, und dieser Test soll auf JEDEM Zweig dasselbe messen.
 */
function laufFahren({ needs, vorgaenger, mitGhPages, veroeffentlichen = 'true' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-e2e-'));
  const cwd = path.join(tmp, 'runner');
  const remote = path.join(tmp, 'ghpages.git').replace(/\\/g, '/');
  fs.mkdirSync(cwd, { recursive: true });
  git(['init', '--bare', '-b', 'gh-pages', remote]);

  if (mitGhPages) {
    // Ein Vor-Stand auf dem Ersatz-gh-pages, damit der Klon-Zweig (statt init) laeuft
    // und ein echter Diff entstehen muss.
    const seed = path.join(tmp, 'seed');
    fs.mkdirSync(path.join(seed, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'index.html'), '<html>alt</html>');
    fs.writeFileSync(path.join(seed, 'outputs', 'coverage-status.json'), '{"schema":"coverage-status/v1"}');
    git(['init', '-b', 'gh-pages'], seed);
    git(['add', '-A'], seed);
    git(['commit', '-m', 'seed'], seed);
    git(['push', remote, 'gh-pages'], seed);
  }

  if (vorgaenger) fs.writeFileSync(path.join(cwd, '_vorgaenger.json'), vorgaenger);

  // Schritt "Statusmarker schreiben" — verbatim, nur der Skript-Pfad wird absolut gemacht
  // (der Test laeuft in einem tmp-Verzeichnis) und der prep-Ausdruck ersetzt.
  let schreib = runBlock(schreibSchritt)
    .replace(/\$\{\{\s*needs\.prep\.outputs\.started_at\s*\}\}/g, '2026-08-16T02:17:00Z')
    .replace('node scripts/pipeline-status.js', 'node ' + JSON.stringify(SKRIPT));
  assert.ok(schreib.includes(SKRIPT), 'die Skript-Pfad-Ersetzung hat nicht getroffen');
  assert.ok(!schreib.includes('${{'), 'im Schreib-Block steht noch ein unersetzter GitHub-Ausdruck: '
    + JSON.stringify((schreib.match(/\$\{\{[^}]*\}\}/) || [''])[0]));

  const rSchreib = sh(schreib, {
    cwd,
    env: {
      NEEDS_JSON: JSON.stringify(needs),
      RUN_ID: '31769403945',
      RUN_ATTEMPT: '1',
      HEAD_SHA: SHA,
    },
  });

  // Schritt "Veroeffentlichen" — verbatim, nur die Remote-URL zeigt aufs lokale bare-Repo.
  let publish = runBlock(publishSchritt);
  const vorher = publish;
  publish = publish.replace(/^GHP_URL=".*"$/m, 'GHP_URL=' + JSON.stringify(remote));
  assert.notEqual(publish, vorher, 'die GHP_URL-Ersetzung hat nicht getroffen — der Test wuerde '
    + 'gegen das echte GitHub laufen oder gar nichts messen.');
  assert.ok(!publish.includes('${{'), 'im Publish-Block steht noch ein unersetzter GitHub-Ausdruck: '
    + JSON.stringify((publish.match(/\$\{\{[^}]*\}\}/) || [''])[0]));

  const rPublish = sh(publish, { cwd, env: {
    MARKER_PFADE: MARKER_REL,
    VEROEFFENTLICHEN: veroeffentlichen,
    GITHUB_REF: veroeffentlichen === 'true' ? 'refs/heads/main' : 'refs/heads/feature/probe',
    NUR_RECHNEN: 'false',
  } });

  // Was ist auf dem Ersatz-gh-pages ANGEKOMMEN?
  let publiziert = null;
  try {
    publiziert = JSON.parse(git(['show', 'gh-pages:' + MARKER_REL], remote));
  } catch (e) { /* nichts publiziert */ }

  return { cwd, remote, rSchreib, rPublish, publiziert };
}

const alleGruen = Object.fromEntries(JOB_REIHENFOLGE.map((n) => [n, { result: 'success', outputs: {} }]));

test('E2E ROTER LAUF: der Marker liegt danach vertragsgueltig auf gh-pages', () => {
  const needs = JSON.parse(JSON.stringify(alleGruen));
  needs.merge.result = 'failure';
  needs.scoring.result = 'skipped';
  const r = laufFahren({
    needs,
    vorgaenger: JSON.stringify({ schema: 'screener-pipeline-status/v1', status: 'success',
      completed_at: '2026-08-09T17:27:00Z', last_success_at: '2026-08-09T17:27:00Z' }),
    mitGhPages: true,
  });
  assert.equal(r.rSchreib.code, 0, 'der Schreib-Schritt ist rot: ' + r.rSchreib.out.trim());
  assert.equal(r.rPublish.code, 0, 'DER MARKER GEHT BEI ROTEM LAUF NICHT RAUS (exit '
    + r.rPublish.code + ') — genau der Fall, fuer den er gebaut ist. Ausgabe: ' + r.rPublish.out.trim());
  assert.ok(r.publiziert, 'auf dem gh-pages-Zweig liegt kein ' + MARKER_REL + ' — der Publish-Schritt '
    + 'meldete Erfolg, ohne etwas zu publizieren.');
  assert.deepEqual(validateMarker(r.publiziert), [],
    'der PUBLIZIERTE Marker verletzt den Vertrag — findash verwirft ihn und zeigt statt der roten '
    + 'Warnleiste eine Vertragsmeldung.');
  assert.equal(r.publiziert.status, 'failure');
  assert.equal(r.publiziert.failed_job, 'merge', 'gemeldet werden muss der ERSTE nicht-gruene Job');
  assert.equal(typeof r.publiziert.attempt_run_id, 'string', 'die Lauf-Nummer muss ein String sein');
  assert.equal(r.publiziert.run_attempt, 1);
  assert.match(r.publiziert.completed_at, /(Z|[+-]\d{2}:?\d{2})$/, 'completed_at ohne Zeitzone');
});

test('E2E (4): der rote Lauf laesst last_success_at UNANGETASTET', () => {
  const needs = JSON.parse(JSON.stringify(alleGruen));
  needs.prep.result = 'failure';
  const r = laufFahren({
    needs,
    vorgaenger: JSON.stringify({ last_success_at: '2026-08-09T17:27:00Z' }),
    mitGhPages: true,
  });
  assert.ok(r.publiziert, 'nichts publiziert: ' + r.rPublish.out.trim());
  assert.equal(r.publiziert.last_success_at, '2026-08-09T17:27:00Z',
    'ein roter Lauf hat den letzten Erfolgszeitpunkt ueberschrieben. Das Banner behauptet dann, die '
    + 'angezeigten Raenge seien von heute — die Luege, gegen die der ganze Marker gebaut ist.');
  assert.notEqual(r.publiziert.last_success_at, r.publiziert.completed_at);
});

test('E2E GRUENER LAUF: last_success_at wird neu gesetzt, kein failed_job', () => {
  const r = laufFahren({ needs: alleGruen, vorgaenger:
    JSON.stringify({ last_success_at: '2026-08-09T17:27:00Z' }), mitGhPages: true });
  assert.ok(r.publiziert, 'nichts publiziert: ' + r.rPublish.out.trim());
  assert.equal(r.publiziert.status, 'success');
  assert.equal(r.publiziert.failed_job, null);
  assert.equal(r.publiziert.last_success_at, r.publiziert.completed_at,
    'ein gruener Lauf setzt den Erfolgszeitpunkt nicht neu — der Vorgaenger-Wert wuerde dann ewig '
    + 'weitergereicht und das Banner naennte spaeter ein uraltes Datum.');
  assert.deepEqual(validateMarker(r.publiziert), []);
});

test('E2E ALLERERSTER LAUF (kein gh-pages, kein Vorgaenger): Marker geht raus, Datum leer', () => {
  const needs = JSON.parse(JSON.stringify(alleGruen));
  needs.scoring.result = 'failure';
  const r = laufFahren({ needs, vorgaenger: null, mitGhPages: false });
  assert.ok(r.publiziert, 'beim allerersten Lauf geht gar kein Marker raus: ' + r.rPublish.out.trim());
  assert.equal(r.publiziert.last_success_at, null,
    'ohne Vorgaenger muss das Feld ehrlich leer bleiben — findash laesst den Datumssatz dann weg, '
    + 'statt "vom unbekannt" zu schreiben.');
  assert.deepEqual(validateMarker(r.publiziert), [], 'ein leeres last_success_at ist vertragsgemaess');
  assert.equal(r.publiziert.failed_job, 'scoring');
});

// ── ZWEIG-WACHE (19.08.2026): der Publish-Schritt darf nur von main aus feuern ───────
// BEFUND: `on: workflow_dispatch:` traegt keine Zweig-Einschraenkung — der Tageslauf laesst
// sich per Hand auf JEDEM Zweig starten. Dieser Schritt pushte trotzdem unbedingt und mit
// --force nach gh-pages. Ein Handlauf von einem Feature-Zweig haette Karls live
// veroeffentlichte Daten mit Zahlen ueberschrieben, die ungepruefter Zweig-Code gerechnet
// hat — Force-Push, also nicht zurueckrollbar. Ausgeloest hat es nie jemand.
// Geprueft wird das VERHALTEN gegen das Ersatz-Remote (was ist ANGEKOMMEN?), nicht ein Text.
// Struktureller Waechter ueber alle sechs Publizierer: tests/zweig-wache.test.js.
test('E2E ZWEIGLAUF: von einem Feature-Zweig geht NICHTS nach gh-pages raus', () => {
  const trocken = laufFahren({ needs: alleGruen, vorgaenger: null, mitGhPages: true,
    veroeffentlichen: 'false' });
  assert.equal(trocken.rSchreib.code, 0, 'der Schreib-Schritt faellt im Trockenlauf aus — gerechnet '
    + 'und geschrieben werden SOLL weiterhin, nur nicht publiziert. Ausgabe: ' + trocken.rSchreib.out.trim());
  assert.equal(trocken.rPublish.code, 0, 'der Zweiglauf endet ROT (exit ' + trocken.rPublish.code
    + '). Nicht zu veroeffentlichen ist kein Fehler — ein rotes X hier wuerde Karls Alarmkanal mit '
    + 'Trockenlaeufen fluten und ihn gegen echte Ausfaelle abstumpfen. Ausgabe: ' + trocken.rPublish.out.trim());
  assert.equal(trocken.publiziert, null,
    'AUF DEM gh-pages-ZWEIG IST ETWAS ANGEKOMMEN, obwohl der Lauf nicht auf main laeuft. Genau '
    + 'dieser Force-Push haette Karls live veroeffentlichte Daten ueberschrieben.');
  assert.match(trocken.rPublish.out, /::warning::NICHT VEROEFFENTLICHT/,
    'die Nicht-Veroeffentlichung steht in KEINER Protokollzeile. Ein gruener Haken ohne Grund ist '
    + 'genau der stille Ausgang vom 12.-15.08. — die Wache muss sich melden, nicht nur schweigen.');

  // Gegenprobe aus der anderen Richtung: derselbe Lauf MIT Wache muss publizieren. Ohne sie
  // koennte oben auch schlicht der ganze Schritt kaputt sein und der Test bewiese nichts.
  const echt = laufFahren({ needs: alleGruen, vorgaenger: null, mitGhPages: true });
  assert.ok(echt.publiziert, 'derselbe Lauf publiziert auch von main aus nichts — dann misst der '
    + 'Trockenlauf-Fall oben einen kaputten Schritt statt der Zweig-Wache.');
});

// ── (2b) Der VIERTE Fehlerpfad: alle drei Push-Versuche erschoepft ───────────────────
// Review 16.08.: fuer die drei anderen Fehlerpfade war je ::error:: + exit 1 gepinnt, fuer
// diesen nicht — nachgewiesen, indem das schliessende `exit 1` entfernt wurde: 20 von 20
// Tests blieben gruen. Ein spaeterer Aufraeum-Commit, der die Zeile fuer redundant haelt
// (die Meldung steht ja schon da), reproduziert damit exakt das Schadensbild vom 12.-15.08.:
// Job gruen, kein Marker, Banner schweigt.
// Geprueft wird das VERHALTEN, nicht der Text: das Ersatz-gh-pages bekommt einen
// pre-receive-Hook, der JEDEN Push ablehnt. Damit laeuft die Retry-Schleife wirklich leer.
test('(2b) alle drei Push-Versuche erschoepft -> ROT (nicht still gruen)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-push-'));
  const cwd = path.join(tmp, 'runner'); fs.mkdirSync(cwd, { recursive: true });
  const remote = path.join(tmp, 'ghpages.git').replace(/\\/g, '/');
  git(['init', '--bare', '-b', 'gh-pages', remote]);
  const seed = path.join(tmp, 'seed'); fs.mkdirSync(seed, { recursive: true });
  fs.writeFileSync(path.join(seed, 'platzhalter.txt'), 'x');
  git(['init', '-b', 'gh-pages'], seed); git(['add', '-A'], seed);
  git(['commit', '-m', 'seed'], seed); git(['push', remote, 'gh-pages'], seed);
  // Ab jetzt lehnt das Remote jeden Push ab.
  fs.writeFileSync(path.join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

  fs.mkdirSync(path.join(cwd, path.dirname(MARKER_REL)), { recursive: true });
  fs.writeFileSync(path.join(cwd, MARKER_REL), JSON.stringify({ schema: 'screener-pipeline-status/v1' }));

  const publish = runBlock(publishSchritt).replace(/^GHP_URL=".*"$/m, 'GHP_URL=' + JSON.stringify(remote));
  assert.ok(!publish.includes('${{'), 'unersetzter GitHub-Ausdruck im Publish-Block');
  // VEROEFFENTLICHEN explizit: dieser Fall misst die Retry-Schleife, nicht die Zweig-Wache.
  const r = sh(publish, { cwd, env: { MARKER_PFADE: MARKER_REL, VEROEFFENTLICHEN: 'true' } });

  // Gegenprobe zuerst: kam ueberhaupt nichts an? Sonst misst dieser Test den falschen Fall.
  let angekommen = true;
  try { git(['show', 'gh-pages:' + MARKER_REL], remote); } catch (e) { angekommen = false; }
  assert.equal(angekommen, false, 'der Push ist trotz ablehnendem pre-receive-Hook durchgegangen — '
    + 'dann bildet dieser Test den Fall "alle Versuche erschoepft" gar nicht ab und beweist nichts.');

  assert.notEqual(r.code, 0, 'ALLE DREI PUSH-VERSUCHE SIND GESCHEITERT UND DER SCHRITT ENDET GRUEN '
    + '(exit 0). Das ist der Schadensfall in Reinform: gruener Job, kein Marker auf gh-pages, '
    + 'Banner schweigt — genau der Zustand vom 12.-15.08. Ausgabe: ' + r.out.trim().slice(-400));
  assert.match(r.out, /::error::/, 'der erschoepfte Retry meldet sich nicht in Karls Kanal (rotes X).');
});

test('E2E (3): ein vertragswidriger Marker wird gar nicht erst publiziert', () => {
  // Ein Job-Ergebnis, das es nicht gibt, ist harmlos (zaehlt als rot). Der scharfe Fall ist
  // ein unbrauchbarer head_sha: findash verwirft den Marker dann komplett. Der Schreib-
  // Schritt muss ihn hart ablehnen, statt ihn zu veroeffentlichen.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psm-bad-'));
  const schreib = runBlock(schreibSchritt)
    .replace(/\$\{\{\s*needs\.prep\.outputs\.started_at\s*\}\}/g, '2026-08-16T02:17:00Z')
    .replace('node scripts/pipeline-status.js', 'node ' + JSON.stringify(SKRIPT));
  const r = sh(schreib, {
    cwd: tmp,
    env: { NEEDS_JSON: JSON.stringify(alleGruen), RUN_ID: '1', RUN_ATTEMPT: '1', HEAD_SHA: 'nicht-hex' },
  });
  assert.equal(r.code, 1, 'ein vertragswidriger Marker wird geschrieben statt abgelehnt (exit '
    + r.code + ') — er ginge raus, und findash zeigte dauerhaft "verletzt den Statusvertrag" '
    + 'statt der roten Warnleiste. Ausgabe: ' + r.out.trim());
  assert.match(r.out, /::error::/, 'die Vertragsverletzung meldet sich nicht in Karls Kanal');
  assert.ok(!fs.existsSync(path.join(tmp, MARKER_REL)),
    'der vertragswidrige Marker liegt trotzdem auf der Platte — der Publish-Schritt wuerde ihn '
    + 'anschliessend deployen.');
});

console.log('\npipeline-status-marker.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
