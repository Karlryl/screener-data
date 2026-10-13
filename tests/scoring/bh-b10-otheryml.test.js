'use strict';
/**
 * b10-otheryml — Test-Gate fuer BH-004/BH-119/BH-131/BH-134 (Workflow-YAML-Fixes).
 * ==================================================================================
 * Kein YAML-Parser noetig (keine neue Dependency) — reine Struktur-/Regressions-
 * Checks auf dem rohen Workflow-Text, analog tests/gate-coverage.test.js.
 *
 * BH-004: monthly-sec-xbrl.yml pullte SEC-companyfacts, baute daraus aber nie die
 *   gescorete external-data/sec-secannual.json (die run-screener.js ausschliesslich
 *   liest) — "Monatspflege" war gruen, ohne dass eine gescorete SEC-Serie je refresht.
 * BH-119: heartbeat.yml mass die Frische am COMMITTETEN Pull-Manifest (vor Scoring/
 *   Export/Deploy gestempelt) statt am tatsaechlich publizierten gh-pages-Produkt —
 *   ein Downstream-Fehler blieb fuer den "unabhaengigen" Waechter unsichtbar.
 * BH-131: weekly-guard.yml/monthly-plan-check.yml gaben nach 3 gescheiterten Push-
 *   Versuchen nur eine ::warning:: aus und liefen als letzten Befehl in ein exit 0 —
 *   ein haengender Marker-/Report-Push machte den Workflow nicht rot.
 * BH-134: weekly-guard.yml/monthly-plan-check.yml/tv-reachability.yml verletzten den
 *   package.json-engines-Vertrag (node>=22) mit node-version '20'.
 *
 * Usage:  node tests/scoring/bh-b10-otheryml.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WF_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WF_DIR, f), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function workflowStepObjects(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const steps = [];
  let inJobs = false;
  let job = null;
  let step = null;
  let runIndent = null;
  let inWith = false;
  for (const raw of lines) {
    const indent = raw.match(/^ */)[0].length;
    const trimmed = raw.trim();
    if (runIndent !== null && step) {
      if (indent > runIndent) { step.run += raw.slice(runIndent + 2) + '\n'; continue; }
      runIndent = null;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indent === 0) { inJobs = trimmed === 'jobs:'; job = null; }
    if (!inJobs) continue;
    const jobMatch = indent === 2 && trimmed.match(/^([A-Za-z0-9_-]+):$/);
    if (jobMatch) { job = jobMatch[1]; step = null; continue; }
    const stepMatch = indent === 6 && trimmed.match(/^-(?:\s+)(name|uses|run):\s*(.*)$/);
    if (job && stepMatch) {
      step = { job, name: null, uses: null, if: null, run: '', with: {} };
      steps.push(step);
      inWith = false;
      const [, key, value] = stepMatch;
      if (key === 'name') step.name = value.trim();
      if (key === 'uses') step.uses = value.trim();
      if (key === 'run') step.run = value.trim() + '\n';
      continue;
    }
    if (!step) continue;
    if (indent === 8 && trimmed === 'with:') { inWith = true; continue; }
    if (indent <= 8) inWith = false;
    if (inWith && indent === 10) {
      const m = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) step.with[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim();
      continue;
    }
    if (indent !== 8) continue;
    const field = trimmed.match(/^(name|uses|if|run):\s*(.*)$/);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'name') step.name = value.trim();
    if (key === 'uses') step.uses = value.trim();
    if (key === 'if') step.if = value.trim();
    if (key === 'run') {
      if (['|', '|-', '|+', '>', '>-'].includes(value.trim())) runIndent = indent;
      else step.run = value.trim() + '\n';
    }
  }
  return steps;
}

function liveShell(run) {
  const out = [];
  let deadDepth = 0;
  for (const line of run.replace(/\r\n/g, '\n').split('\n')) {
    const code = line.replace(/\s+#.*$/, '').trim();
    if (/^if\s+(?:false|\[\s+"?0"?\s+=\s+"?1"?\s+\])\s*;?\s*then\b/.test(code)) { deadDepth++; continue; }
    if (deadDepth && /^if\b.*\bthen\b/.test(code)) { deadDepth++; continue; }
    if (deadDepth && /^fi\b/.test(code)) { deadDepth--; continue; }
    if (!deadDepth) out.push(line);
  }
  return out.join('\n');
}

function oneStep(steps, predicate, label) {
  const found = steps.filter(predicate);
  assert.equal(found.length, 1, `${label}: genau ein Workflow-Step erwartet, gefunden ${found.length}`);
  return found[0];
}

// ---- BH-004: monthly-sec-xbrl.yml baut + committet sec-secannual.json ----------
const secXbrl = read('monthly-sec-xbrl.yml');
const secSteps = workflowStepObjects(secXbrl);

test('BH-004: Build ist ein erreichbarer Step; tote if-false-Attrappen und fruehes exit 0 zaehlen nicht', () => {
  const build = oneStep(secSteps, (s) => s.job === 'pull' && s.name === 'Build sec-secannual (scored deep-XBRL layer)', 'SEC-Build');
  assert.ok(!/^false$|^\$\{\{\s*false\s*\}\}$/i.test(build.if || ''), 'SEC-Build-Step ist deaktiviert');
  const live = liveShell(build.run);
  const iBuild = live.indexOf('node scripts/build-secannual.js');
  assert.ok(iBuild >= 0, 'Build-Aufruf existiert nur in einem literal toten if-false-Block');
  assert.ok(!/(^|\n)\s*exit\s+0\b/.test(live.slice(0, iBuild)), 'unbedingtes exit 0 beendet den Step vor dem Build');
});

test('BH-004: Pull-Job baut die gescorete sec-secannual.json (build-secannual.js)', () => {
  assert.match(secXbrl, /node scripts\/build-secannual\.js/,
    'kein Aufruf von scripts/build-secannual.js im Workflow');
});

test('BH-004: der Build-Schritt laeuft NACH dem SEC-Pull, VOR dem Commit', () => {
  const iPull = secXbrl.indexOf('node pull-sec-xbrl.js');
  const iBuild = secXbrl.indexOf('node scripts/build-secannual.js');
  const iCommit = secXbrl.indexOf('name: Commit manifest');
  assert.ok(iPull > -1 && iBuild > -1 && iCommit > -1, 'einer der drei Marker fehlt');
  assert.ok(iPull < iBuild && iBuild < iCommit,
    `Reihenfolge falsch (pull@${iPull} build@${iBuild} commit@${iCommit})`);
});

test('BH-004: external-data/sec-secannual.json wird mitcommittet (git add)', () => {
  assert.match(secXbrl, /git add external-data\/sec-xbrl\/_manifest\.json external-data\/sec-secannual\.json/,
    'sec-secannual.json fehlt im git-add des Commit-Schritts');
});

// ---- BH-004 round 2: der Build-Schritt braucht ein ECHTES Universum -------------
// (der erste Fix rief build-secannual.js korrekt auf, aber snapshots/ ist im CI-
// Checkout leer bis auf _manifest.json -> loadUniverse()==[] -> p75 undefined ->
// TypeError. Textmarker-Checks allein haetten diese Regression nicht gefangen.)
test('BH-004: Build-Step sitzt hinter einem Snapshot-Restore (Universe-Verfuegbarkeit), nicht direkt nach dem rohen XBRL-Pull', () => {
  const iCoverage = secXbrl.indexOf('name: Verify SEC Coverage');
  const iBuild = secXbrl.indexOf('name: Build sec-secannual');
  assert.ok(iCoverage > -1 && iBuild > -1, 'einer der beiden Marker fehlt');
  const between = secXbrl.slice(iCoverage, iBuild);
  assert.match(between, /snapshots/i,
    'kein snapshots-Bezug zwischen Coverage-Check und Build — das Universum wird nicht wiederhergestellt');
  assert.match(between, /download-artifact|pull-yahoo\.js/,
    'weder Artefakt-Restore (download-artifact) noch pull-yahoo zwischen Coverage-Check und Build');
});

test('BH-004: Build-Step ist an die Snapshot-Restore-Bedingung gegated statt unconditional zu laufen', () => {
  const iBuild = secXbrl.indexOf('name: Build sec-secannual');
  const iCommit = secXbrl.indexOf('name: Commit manifest');
  const buildBlock = secXbrl.slice(iBuild, iCommit);
  assert.match(buildBlock, /if:\s*steps\.\w+\.outputs\./,
    'Build-Step hat kein if:-Gate auf einen vorherigen Step-Output — liefe auch ohne Universum an');
});

// ---- BH-119: heartbeat.yml misst das publizierte gh-pages-Produkt --------------
const heartbeat = read('heartbeat.yml');
const heartbeatSteps = workflowStepObjects(heartbeat);

test('BH-119: Export-Freshness ist ein erreichbares Step-Objekt und liest im aktiven run das Deploy-Produkt', () => {
  const step = oneStep(heartbeatSteps, (s) => s.job === 'freshness' && s.name === 'Check export freshness', 'Export-Freshness');
  assert.ok(!/^false$|^\$\{\{\s*false\s*\}\}$/i.test(step.if || ''), 'Export-Freshness-Step ist deaktiviert');
  const live = liveShell(step.run);
  assert.match(live, /gh-pages\/outputs\/findash-export\/v1\/index\.json/);
  assert.match(live, /idx\.generated_at/);
});

test('BH-119: Freshness-Check liest gh-pages findash-export/v1/index.json (nicht mehr das lokale Pull-Manifest)', () => {
  assert.match(heartbeat, /gh-pages\/outputs\/findash-export\/v1\/index\.json/,
    'kein gh-pages-Fetch von findash-export/v1/index.json');
  assert.match(heartbeat, /idx\.generated_at/,
    'liest nicht mehr .generated_at aus dem deployten Export');
});

test('BH-119: der alte Bug-Pfad (lokales _manifest.json .pulled_at als alleinige Quelle) ist ersetzt', () => {
  // Der Preis-Substrat-Check (A7-b) und der Kadenz-Dead-Man duerfen weiterhin lokale
  // Dateien lesen (andere Zwecke) — nur der EXPORT-Freshness-Block darf sich nicht
  // mehr auf snapshots/_manifest.json stuetzen.
  const exportBlock = heartbeat.slice(
    heartbeat.indexOf('name: Check export freshness'),
    heartbeat.indexOf('name: Check price-substrate freshness')
  );
  assert.ok(!/snapshots\/_manifest\.json/.test(exportBlock),
    'Export-Freshness-Block liest noch snapshots/_manifest.json');
});

// ---- BH-131: Push-Retry-Loop wird bei 3x Fehlschlag fail-loud -------------------
const weeklyGuard = read('weekly-guard.yml');
const monthlyPlan = read('monthly-plan-check.yml');

for (const [name, wf] of [['weekly-guard.yml', weeklyGuard], ['monthly-plan-check.yml', monthlyPlan]]) {
  test(`BH-131 (${name}): Retry-Schleife rebase-abort't vor jedem Versuch`, () => {
    assert.match(wf, /git rebase --abort/, 'kein git rebase --abort vor dem Retry');
  });
  test(`BH-131 (${name}): erschoepfte Push-Retries enden fail-loud (exit 1), nicht nur ::warning::`, () => {
    const iLoop = wf.indexOf('for i in 1 2 3');
    assert.ok(iLoop > -1, 'Push-Retry-Schleife nicht gefunden');
    let iNextStep = wf.indexOf('- name:', iLoop);
    if (iNextStep === -1) iNextStep = wf.length;
    const stepTail = wf.slice(iLoop, iNextStep); // Rest des Retry-Steps bis zum naechsten Step
    assert.match(stepTail, /Versuchen/, 'die 3-Versuche-Fehlermeldung fehlt im Step-Rest');
    assert.match(stepTail, /\bexit 1\b/,
      'kein exit 1 nach der 3-Versuche-Fehlermeldung — Step bliebe gruen (nur ::warning:: -> implizit exit 0)');
  });
}

// ---- BH-134: node-version Vertrag (package.json engines >=22) ------------------
const tvReach = read('tv-reachability.yml');
const structured = [
  ['weekly-guard.yml', workflowStepObjects(weeklyGuard)],
  ['monthly-plan-check.yml', workflowStepObjects(monthlyPlan)],
  ['tv-reachability.yml', workflowStepObjects(tvReach)],
];
test('BH-134: aktive setup-node-Step-Objekte tragen numerisch Node 22, unabhaengig von YAML-Quotes', () => {
  for (const [name, steps] of structured) {
    const setup = oneStep(steps, (s) => /^actions\/setup-node@/.test(s.uses || ''), name + '/setup-node');
    assert.equal(Number(setup.with['node-version']), 22, `${name}: aktiver setup-node-Step nutzt ${setup.with['node-version']}`);
  }
});
for (const [name, wf] of [
  ['weekly-guard.yml', weeklyGuard],
  ['monthly-plan-check.yml', monthlyPlan],
  ['tv-reachability.yml', tvReach],
]) {
  test(`BH-134 (${name}): node-version ist '22' (nicht mehr '20')`, () => {
    assert.match(wf, /node-version:\s*'22'/, "node-version: '22' fehlt");
    assert.ok(!/node-version:\s*'20'/.test(wf), "node-version: '20' noch vorhanden");
  });
}

// ---- BH-004 runtime: build-secannual.js darf bei leerem Universum NICHT crashen ---
// Der Text-Check oben beweist nur, dass die YAML den Restore-Schritt VORSIEHT — nicht,
// dass der Code selbst standhaelt, falls der Restore trotzdem leer bleibt (abgelaufenes
// Artefakt, kein daily-pull-Lauf gefunden). Echter Laufzeit-Aufruf gegen ein leeres,
// temporaeres Snapshot-Verzeichnis (SEC_SNAPSHOTS_DIR-Hook) statt gegen die real
// befuellte, git-ignorierte snapshots/ dieses Checkouts.
(async () => {
  const os = require('node:os');
  const buildSecannualPath = require.resolve('../../scripts/build-secannual.js');
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh004-empty-snap-'));
  const prevEnv = process.env.SEC_SNAPSHOTS_DIR;
  process.env.SEC_SNAPSHOTS_DIR = emptyDir;
  delete require.cache[buildSecannualPath];
  try {
    const { run } = require(buildSecannualPath);
    await run();
    pass++;
    console.log('  ok   BH-004: build-secannual.js run() mit leerem Universum wirft NICHT (Empty-Universe-Guard)');
  } catch (e) {
    fail++;
    console.error('FAIL   BH-004: build-secannual.js run() crasht bei leerem Universum\n       ' + e.stack);
  } finally {
    if (prevEnv === undefined) delete process.env.SEC_SNAPSHOTS_DIR; else process.env.SEC_SNAPSHOTS_DIR = prevEnv;
    delete require.cache[buildSecannualPath];
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }

  console.log(fail ? `\n${fail} FAIL` : `\nAlle ${pass} bh-b10-otheryml-Checks ok`);
  process.exit(fail ? 1 : 0);
})();
