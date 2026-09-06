// tests/pr-check-live-gate.test.js — Standalone-Runner (framework-los).
// Run: node tests/pr-check-live-gate.test.js
//
// WOFUER (A2, Ratsbrief 06.09.2026, Master-Ratifikation ~75 %): der PR-Check laedt das Snapshot-
// Artefakt des juengsten Tageslaufs und faehrt dieselben zehn Live-Universum-Suiten wie der
// scoring-Job dagegen; fehlt das Artefakt (Retention/Timing), skippt er SICHTBAR (::warning::), nie rot.
// Gepinnt wird die SACHE: G1 die Suiten-MENGE ist identisch mit daily-pull (Register 6.0 06.09.:
// delegierte Strenge als Menge pinnen), G2 die Berechtigung actions: read, G3 der download-artifact-
// Pin ist derselbe SHA wie in daily-pull und traegt run-id + github-token, G4/G5 der Such-Schritt
// unter bash mit gestubbtem `gh`: leer -> ::warning:: + Exit 0 + rid leer; Treffer -> rid gesetzt.
// Sabotage-Nachweis (Anker 06.09. N30): eine Suite aus dem PR-Aufruf entfernt -> G1 rot; `exit 0`
// im Leer-Zweig auf `exit 1` -> G4 rot.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const ROOT = path.join(__dirname, '..');
const pr = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-check.yml'), 'utf8');
const daily = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8');
const SUCHE = 'name: Letztes Tages-Snapshot-Artefakt suchen (A2)';
const LADEN = 'name: Snapshots des letzten Tageslaufs laden (A2)';
const GATE_PR = 'name: Live-Universum-Gate (PR-Check, Universum von gestern, A2)';
const GATE_DAILY = 'name: Live-Universum-Gate (score.integration';

function suiten(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker); assert.ok(a >= 0, startMarker + ' nicht gefunden');
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  const block = text.slice(a, b > a ? b : text.length);
  const s = block.match(/tests\/scoring\/[a-z0-9.-]+test\.js/g) || [];
  return [...new Set(s)].sort();
}
function runBlock(text, stepName) {
  const i = text.indexOf(stepName); assert.ok(i > 0, stepName + ' nicht gefunden');
  const r = text.indexOf('run: |', i);
  const lines = [];
  for (const l of text.slice(r + 'run: |'.length + 1).split('\n')) { if (l.trim() === '' || l.startsWith('          ')) lines.push(l.slice(10)); else break; }
  return lines.join('\n');
}
function bashMitGhStub(block, ghAusgabe, ghRc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-'));
  try {
    fs.writeFileSync(path.join(dir, 'gh'), '#!/usr/bin/env bash\nprintf "%s" "' + ghAusgabe + '"\nexit ' + ghRc + '\n');
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
    const out = path.join(dir, 'out.txt'); fs.writeFileSync(out, '');
    const script = block.replace(/\$\{\{ github\.repository \}\}/g, 'x/y');
    const r = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, GITHUB_OUTPUT: out, GH_TOKEN: 't' } });
    assert.ok(!r.error, 'bash nicht ausfuehrbar: ' + (r.error && r.error.message));
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), output: fs.readFileSync(out, 'utf8') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

check('G1: die Suiten-Menge des PR-Live-Gates ist IDENTISCH mit dem scoring-Job (zehn Suiten)', () => {
  const prS = suiten(pr, GATE_PR, null);
  const dailyS = suiten(daily, GATE_DAILY, 'name: Gate-Ergebnis belegen');
  assert.deepStrictEqual(prS, dailyS, 'Mengen weichen ab');
  assert.strictEqual(prS.length, 10);
});
check('G2: pr-check.yml traegt actions: read (Artefakt eines anderen Laufs lesen) und weiterhin contents: read', () => {
  const kopf = pr.slice(0, pr.indexOf('jobs:'));
  assert.ok(/\n\s+actions: read\n/.test(kopf), 'actions: read fehlt');
  assert.ok(/\n\s+contents: read\n/.test(kopf), 'contents: read fehlt');
  assert.ok(!/write/.test(kopf), 'keine write-Berechtigung im PR-Check');
});
check('G3: der download-artifact-Schritt ist auf denselben SHA gepinnt wie daily-pull und traegt run-id + github-token, gated auf rid', () => {
  const shaDaily = (daily.match(/actions\/download-artifact@([0-9a-f]{40})/) || [])[1];
  const i = pr.indexOf(LADEN); assert.ok(i > 0);
  const block = pr.slice(i, pr.indexOf(GATE_PR, i));
  assert.ok(shaDaily && block.includes('actions/download-artifact@' + shaDaily), 'SHA weicht von daily-pull ab');
  assert.ok(/run-id: \$\{\{ steps\.artefakt\.outputs\.rid \}\}/.test(block), 'run-id fehlt');
  assert.ok(/github-token: \$\{\{ github\.token \}\}/.test(block), 'github-token fehlt');
  assert.ok(/if: steps\.artefakt\.outputs\.rid != ''/.test(block), 'nicht auf rid gated');
  const g = pr.slice(pr.indexOf(GATE_PR));
  assert.ok(/if: steps\.artefakt\.outputs\.rid != ''/.test(g.slice(0, 200)), 'Gate-Schritt nicht auf rid gated');
});
check('G4: kein Artefakt (gh liefert leer) -> ::warning:: + Exit 0 + rid leer (Shell-Block ausgefuehrt)', () => {
  const r = bashMitGhStub(runBlock(pr, SUCHE), '', 0);
  assert.strictEqual(r.code, 0, 'Exit ' + r.code + '\n' + r.out);
  assert.ok(/::warning::A2: kein nicht-abgelaufenes snapshots-Artefakt/.test(r.out), r.out);
  assert.ok(/^rid=$/m.test(r.output), 'rid nicht leer gesetzt: ' + r.output);
  const r2 = bashMitGhStub(runBlock(pr, SUCHE), '', 1);   // gh selbst rot -> ebenfalls Warnung, nie rot
  assert.strictEqual(r2.code, 0); assert.ok(/::warning::/.test(r2.out));
});
check('G5: Artefakt gefunden (gh liefert eine Lauf-ID) -> rid gesetzt, Exit 0', () => {
  const r = bashMitGhStub(runBlock(pr, SUCHE), '34012345678', 0);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(/^rid=34012345678$/m.test(r.output), 'rid falsch: ' + r.output);
  assert.ok(!/::warning::/.test(r.out));
});

if (fail) { console.log('FAIL: pr-check-live-gate (' + fail + ')'); process.exit(1); }
console.log('OK: pr-check-live-gate (A2, 06.09.2026)');
