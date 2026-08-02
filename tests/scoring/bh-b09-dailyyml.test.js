'use strict';
/**
 * BH-003/035/113/114/118/121/136/143/156 regression (batch b09-dailyyml,
 * .github/workflows/daily-pull.yml). CI-orchestration fixes — the "logic" lives
 * in the workflow text + embedded bash, so this suite is mostly text-anchored
 * regression checks against the fixed patterns (proving the old broken pattern
 * is gone and the new one is present), plus a couple of isolated pure-function
 * re-implementations of embedded one-liners where real logic exists (BH-121).
 *
 * (BH-027, BH-073, BH-115, BH-152, BH-153 are skipped as decisions — no code
 * change, nothing to regression-test here.)
 *
 * Standalone runner (node <datei>, exit 0/1) — no network, only local git
 * metadata (git ls-files) and the checked-out workflow file itself.
 *
 * Run: node tests/scoring/bh-b09-dailyyml.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const YML_PATH = path.join(ROOT, '.github', 'workflows', 'daily-pull.yml');
const yml = fs.readFileSync(YML_PATH, 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function section(startMarker, endMarker) {
  const s = yml.indexOf(startMarker);
  assert.ok(s >= 0, 'Marker nicht gefunden: ' + startMarker);
  const eSearchFrom = s + startMarker.length;
  const e = endMarker ? yml.indexOf(endMarker, eSearchFrom) : yml.length;
  assert.ok(!endMarker || e > s, 'End-Marker nicht gefunden: ' + endMarker);
  return yml.slice(s, e < 0 ? yml.length : e);
}

// ── BH-035: Waechter/Gate-Glob faengt jetzt auch die '-test.js'-Schreibweise ─
test('BH-035: GATE_GLOB nutzt *test.js (faengt .test.js UND -test.js)', () => {
  assert.match(yml, /GATE_GLOB: 'tests\/\*test\.js tests\/scoring\/\*test\.js lib\/\*test\.js'/);
});
test('BH-035: Waechter-Enumeration nutzt dasselbe erweiterte Pattern', () => {
  assert.match(yml, /git ls-files '\*test\.js' \| grep -v '\/fixtures\/'/);
});
test('BH-035: git ls-files \'*test.js\' faengt die drei SEC-Smokes, das alte \'*.test.js\' nicht (Regressionsbeweis)', () => {
  const newOut = execFileSync('git', ['ls-files', '*test.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  const oldOut = execFileSync('git', ['ls-files', '*.test.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  for (const f of ['tests/13f-test.js', 'tests/sec-form4-test.js', 'tests/sec-user-agent-test.js']) {
    assert.ok(newOut.includes(f), f + ' fehlt im neuen Pattern');
    assert.ok(!oldOut.includes(f), f + ' waere schon vom alten Pattern gefangen worden — Praemisse von BH-035 stimmt nicht mehr');
  }
});

// ── BH-003: Live-Universum-Gate im scoring-Job, direkt nach dem Snapshot-Download
test('BH-003: Reihenfolge Download-Snapshots -> Live-Universum-Gate -> Run Hypergrowth Screener', () => {
  const iDl = yml.indexOf('name: Download Snapshots Artifact');
  const iGate = yml.indexOf('name: Live-Universum-Gate');
  const iRun = yml.indexOf('name: Run Hypergrowth Screener');
  assert.ok(iDl > 0 && iGate > iDl && iRun > iGate, 'Schritt-Reihenfolge im scoring-Job verletzt');
});
test('BH-003: alle vier Live-Universum-Suiten werden im Gate-Step aufgerufen', () => {
  const s = section('name: Live-Universum-Gate', 'name: Download merge');
  for (const t of ['score.integration.test.js', 'quality-board.test.js', 'phase.test.js', 'score-breakdown.test.js']) {
    assert.ok(s.includes('tests/scoring/' + t), t + ' fehlt im Live-Universum-Gate-Step');
  }
});
test('BH-003: ein echter No-Universe-Skip (pre-pull-Gate-Sentinel) wird im scoring-Job als Fehler behandelt', () => {
  const s = section('name: Live-Universum-Gate', 'name: Download merge');
  assert.match(s, /grep -q 'pre-pull-Gate'/);
  assert.match(s, /fail=1/);
});
test('BH-003: das Gate matcht NICHT auf den blossen "kein Universum"-String (faelscht sonst bei Teil-Skips falsch-rot)', () => {
  const s = section('name: Live-Universum-Gate', 'name: Download merge');
  assert.ok(!/grep -q 'kein Universum'/.test(s), 'alter Falsch-Rot-Sentinel noch vorhanden');
});

// ── BH-121: FX-Freshness liest fetchedAt aus fx-rates.json statt Datei-Mtime ─
test('BH-121: Verify FX-Rates Freshness liest fetchedAt statt stat -c %Y', () => {
  const s = section('name: Verify FX-Rates Freshness', 'name: Pull Insider Form-4');
  assert.ok(!s.includes('stat -c %Y'), 'alte Datei-Mtime-Messung noch vorhanden');
  assert.match(s, /d\.fetchedAt\s*\?\s*Date\.parse\(d\.fetchedAt\)/);
});
// Isolierte Nachbildung des eingebetteten node-Einzeilers (identische Fail-open-
// Semantik) — Fresh/Stale/Missing/Corrupt an vier Fixtures durchgespielt.
function fxFetchedEpochSec(fxJsonText, nowSec) {
  try {
    const d = JSON.parse(fxJsonText);
    const t = d.fetchedAt ? Date.parse(d.fetchedAt) : NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000) : nowSec;
  } catch (e) { return nowSec; }
}
test('BH-121: fxFetchedEpochSec — frisches fetchedAt -> Alter 0 Tage', () => {
  const now = Math.floor(Date.now() / 1000);
  const fetched = fxFetchedEpochSec(JSON.stringify({ fetchedAt: new Date().toISOString() }), now);
  assert.equal(Math.floor((now - fetched) / 86400), 0);
});
test('BH-121: fxFetchedEpochSec — 40 Tage altes fetchedAt -> Alter 40 (> 30d Hard-Fail-Schwelle)', () => {
  const now = Math.floor(Date.now() / 1000);
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const fetched = fxFetchedEpochSec(JSON.stringify({ fetchedAt: old }), now);
  assert.equal(Math.floor((now - fetched) / 86400), 40);
});
test('BH-121: fxFetchedEpochSec — fehlendes fetchedAt faellt fail-open auf NOW zurueck', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(fxFetchedEpochSec(JSON.stringify({ rates: {} }), now), now);
});
test('BH-121: fxFetchedEpochSec — kaputtes JSON faellt fail-open auf NOW zurueck', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(fxFetchedEpochSec('not json', now), now);
});

// ── BH-143: Prune laeuft jetzt NACH dem echten Snapshot-Download im merge-Job ─
test('BH-143: prep-Job ruft "Prune Watchlist" nicht mehr vor dem Fan-out auf', () => {
  const prepBlock = yml.slice(0, yml.indexOf('# PULL (matrix'));
  assert.ok(!/name:\s*Prune Watchlist\b/.test(prepBlock), 'prep-Job pruned noch vor dem Fan-out (altes Verhalten)');
});
test('BH-143: Reihenfolge Download-Snapshots -> Prune (post-snapshot) -> Merge-Manifests', () => {
  const iDl = yml.indexOf('name: Download all shard snapshots');
  const iPrune = yml.indexOf('name: Prune Watchlist (post-snapshot)');
  const iMerge = yml.indexOf('name: Merge shard manifests (recount');
  assert.ok(iDl > 0 && iPrune > iDl && iMerge > iPrune, 'Reihenfolge im merge-Job verletzt');
});

// ── BH-113 / BH-114: beide gh-pages-Deploys pruefen Branch-Existenz vor jedem
//    destruktiven git-init-Fallback (statt jeden Clone-Fehler pauschal so zu lesen)
test('BH-113: Deploy 1 (merge-Job) klont bestehenden gh-pages statt git init -b (voller Re-Init)', () => {
  // 29.07.: Endmarke war `name: Notify on failure` — der Discord-Schritt, der mit dem
  // Discord-Ausbau verschwunden ist. Der Deploy ist jetzt der LETZTE Schritt des
  // merge-Jobs; die Endmarke ist deshalb der naechste Job. Der haelt laenger als ein
  // beliebiger Nachbarschritt.
  const s = section('name: Deploy to GitHub Pages', '\n  scoring:');
  assert.match(s, /git ls-remote --exit-code/);
  assert.match(s, /git clone --depth 1 --branch gh-pages/);
});
test('BH-114: Deploy 2 (scoring-Job) prueft Branch-Existenz vor dem Fallback, alter blinder ||-Fallback ist weg', () => {
  const s = section('name: Deploy Scoring Output to GitHub Pages', 'name: Write board-history vintage');
  assert.match(s, /git ls-remote --exit-code/);
  assert.ok(!/\|\|\s*\{\s*mkdir -p _ghp;\s*cd _ghp;\s*git init -b gh-pages;\s*cd \.\.;\s*\}/.test(s),
    'alter destruktiver ||-Fallback (jeder Clone-Fehler -> git init) noch vorhanden');
});

// ── BH-118: coverage-status.json faehrt im merge->scoring-Handoff-Artefakt mit
test('BH-118: outputs/coverage-status.json im merge->scoring-Handoff-Artefakt-Pfad', () => {
  const s = section('name: Upload merge', 'name: Pipeline Health Check');
  assert.match(s, /outputs\/coverage-status\.json/);
});

// ── BH-136: Actions auf volle Commit-SHAs gepinnt, kein beweglicher @v4-Tag mehr
test('BH-136: keine beweglichen actions/*@v4-Referenzen mehr', () => {
  assert.ok(!/uses:\s*actions\/[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)?@v4\b/.test(yml),
    'noch mindestens eine actions/*@v4-Referenz gefunden');
});
test('BH-136: actions/checkout ist auf einen vollen 40-Zeichen-SHA gepinnt, Version im Kommentar', () => {
  assert.match(yml, /uses: actions\/checkout@[0-9a-f]{40} # v4\.\d+\.\d+/);
});
test('BH-136: jede uses:-Zeile fuer actions/* ist SHA-gepinnt (kein Tag mehr)', () => {
  const usesLines = yml.split('\n').filter((l) => /uses:\s*actions\//.test(l));
  assert.ok(usesLines.length > 0, 'keine actions/*-uses-Zeilen gefunden — Test-Anker falsch?');
  for (const l of usesLines) {
    assert.match(l, /@[0-9a-f]{40}\b/, 'Zeile nicht auf vollen SHA gepinnt: ' + l.trim());
  }
});

// ── BH-156: SUSPECT-Vintage (rc=2) wird vom Commit ausgenommen, nicht mehr
//    bedingungslos committet+gepusht
test('BH-156: Write-Step stempelt das tatsaechliche Vintage-Datum als Output (fuer den Exclude-Pfad unten)', () => {
  const s = section('name: Write board-history vintage', 'name: Commit board-history vintage');
  assert.match(s, /echo "date=\$\(date -u \+%F\)" >> "\$GITHUB_OUTPUT"/);
});
test('BH-156: Commit-Step schliesst das Tagesverzeichnis bei rc=2 per Pathspec vom `git add` aus', () => {
  const s = section('name: Commit board-history vintage to main', null);
  // Tag 512 hat rc in eine Shell-Variable gehoben, damit Betreffzeile und Ausschluss
  // dieselbe Quelle nutzen. Der alte Anker verlangte rc-Ausdruck und `= "2"` in EINER
  // Zeile und ging daran kaputt. Geprueft wird jetzt die Sache statt der Schreibweise:
  // der verglichene Wert MUSS aus steps.vintage.outputs.rc stammen (direkt oder ueber
  // genau eine Shell-Variable), und GENAU dieser rc=2-Zweig macht den Ausschluss,
  // waehrend der else-Zweig weiterhin voll addet.
  const rcVar = s.match(/(\w+)="\$\{\{\s*steps\.vintage\.outputs\.rc\s*\}\}"/);
  const rcExpr = rcVar ? '$' + rcVar[1] : '${{ steps.vintage.outputs.rc }}';
  const branch = s.match(/if \[ "([^"]+)" = "2" \]; then([\s\S]*?)\n[ \t]*else\r?\n([\s\S]*?)\n[ \t]*fi\b/);
  assert.ok(branch, 'keine rc=2-Verzweigung um den `git add` gefunden');
  assert.equal(branch[1], rcExpr,
    'rc=2-Vergleich haengt nicht am rc des Write-Steps, sondern an: ' + branch[1]);
  assert.match(branch[2], /git add board-history\/ ":\(exclude\)board-history\/\$VINTAGE_DATE"/);
  assert.match(branch[3], /git add board-history\/\s*$/, 'else-Zweig addet das Vintage nicht mehr voll');
});
test('BH-156: unconditional "git add board-history/" vor der rc-Verzweigung ist weg', () => {
  const s = section('name: Commit board-history vintage to main', null);
  const beforeIf = s.slice(0, s.indexOf('git add board-history/'));
  // Vorher: git add board-history/ lief IMMER als allererste Aktion nach den
  // git-config-Zeilen, unabhaengig von rc. Jetzt muss die rc-Verzweigung davor stehen.
  assert.match(beforeIf, /steps\.vintage\.outputs\.rc/, 'git add laeuft noch VOR der rc-Pruefung (altes bedingungsloses Verhalten)');
});

console.log('\nbh-b09-dailyyml.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
