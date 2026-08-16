'use strict';
/**
 * Bruell-Kanal, Waechter 3 (Tag 979, Beschluss 16.08.) — die Verdrahtung in daily-pull.yml.
 *
 * DIE ZUSICHERUNG, UM DIE ES GEHT, IST EINE REIHENFOLGE, KEIN TEXT:
 * Reisst eine Direktive-4-Prozentil-Schwelle, sollen die Boards TROTZDEM ausgeliefert werden
 * und der Lauf DANACH rot werden. Der alte Zustand (Riss = Tageslauf blockiert) war Karls
 * schlimmster: fuenf Naechte 11.-15.08. ohne frische Boards, und die Verletzung dadurch
 * UNSICHTBARER statt sichtbarer.
 *
 * Drei Dinge muessen dafuer gleichzeitig stimmen, und alle drei werden hier AUSGEFUEHRT
 * bzw. strukturell gepinnt, nicht per Quelltext-Grep behauptet:
 *
 *  (A) Der Gate-Step im scoring-Job behandelt exit 2 von anchors.rank.test.js NICHT als
 *      Fehler — sonst stuende der Job und nichts ginge raus (= der alte Zustand mit mehr Code).
 *      Jeder andere Nonzero-Code und jede andere Suite bleiben hart.
 *  (B) Das Bruell-Rot sitzt im laufstatus-Job, NICHT im scoring-Job. Im scoring-Job wuerde es
 *      `needs.scoring.result` auf 'failure' drehen; der Statusmarker rechnet sein status-Feld
 *      genau aus diesen sechs Datenjobs, und der Merge-Zaehler haenge daran. Der Beschluss
 *      haette sich selbst sabotiert (Nachtrag 16.08.).
 *  (C) Der Bruell-Schritt ist der LETZTE Schritt des laufstatus-Jobs — der Statusmarker ist
 *      dann schon publiziert. Genau das ist "liefern UND bruellen".
 *
 * Der run-Block selbst wird mit `bash -eo pipefail` gegen echte Marker-Dateien gefahren
 * (Bauform aus tests/pipeline-status-marker.test.js), inklusive der stillen Richtung:
 * status=ok MUSS gruen durchgehen, sonst waere der Kanal ein Dauer-Rot.
 *
 * Run: node tests/bruell-kanal.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8')
  .replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Rumpf EINES benannten Schritts (Bauart aus t564 / pipeline-status-marker). */
function schritt(text, startMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + startMarker);
  const alle = text.slice(s).split('\n');
  const zeilen = [alle[0]];
  for (let i = 1; i < alle.length; i++) {
    if (/^ {6}- /.test(alle[i]) || /^ {0,5}\S/.test(alle[i])) break;
    zeilen.push(alle[i]);
  }
  return zeilen.join('\n');
}
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
function runBlock(section) {
  const i = section.indexOf('run: |');
  assert.ok(i >= 0, 'kein `run: |` im Schritt');
  return section.slice(i + 'run: |'.length).split('\n').map((z) => z.replace(/^ {10}/, '')).join('\n');
}
function bashBinaer() {
  const kandidaten = ['bash', 'C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe'];
  for (const k of kandidaten) {
    try { execFileSync(k, ['-c', 'exit 0'], { stdio: 'ignore' }); return k; } catch (e) { /* naechster */ }
  }
  return assert.fail('keine ausfuehrbare bash gefunden — dieser Waechter kann das Bruell-Verhalten '
    + 'dann nicht messen. Ein stiller Skip waere hier der schlimmste Ausgang.');
}
// GitHub faehrt run-Bloecke als `bash -e {0}`; ohne errexit waere der Harness blind fuer
// jede Regression, deren Sichtbarkeit am Abbruch haengt.
function sh(block, { cwd, env }) {
  try {
    const out = execFileSync(bashBinaer(), ['-eo', 'pipefail', '-c', block],
      { cwd, encoding: 'utf8', env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const scoring = job(daily, 'scoring');
const laufstatus = job(daily, 'laufstatus');
const gateStep = schritt(daily, 'name: Live-Universum-Gate');
const bruellStep = schritt(daily, 'name: Anker-Bruellen');
const bruellRun = runBlock(bruellStep);

// ── (A) Der Gate-Step laesst exit 2 durch, alles andere nicht ────────────────────────
test('(A) Gate-Step setzt ANCHOR_STATUS_OUT — ohne Marker gibt es kein Banner und nichts zu bruellen', () => {
  assert.match(gateStep, /ANCHOR_STATUS_OUT:\s*outputs\/anchor-status\.json/,
    'der Gate-Step erzeugt den Anker-Marker nicht mehr — Dashboard-Banner und Bruell-Schritt sind damit blind');
});
test('(A) exit 2 von anchors.rank.test.js setzt fail NICHT — sonst blockiert ein Rangfolge-Riss wieder', () => {
  const g = runBlock(gateStep);
  const i2 = g.indexOf('"$rc" -eq 2');
  assert.ok(i2 > 0, 'kein exit-2-Zweig im Gate-Step: ein Rangfolge-Riss blockt wieder den ganzen Tageslauf');
  // Der Zweig muss an DIE Suite gebunden sein, die den exit-2-Vertrag hat — nicht an alle.
  assert.match(g.slice(i2, i2 + 200), /anchors\.rank\.test\.js/,
    'der exit-2-Zweig ist nicht an anchors.rank.test.js gebunden — dann wuerde ein exit 2 einer '
    + 'BELIEBIGEN Suite stillschweigend durchgewunken');
  // Der Zweig darf nicht selbst fail=1 setzen.
  const zweig = g.slice(i2, g.indexOf('elif', i2) >= 0 ? g.indexOf('elif', i2) : i2 + 400);
  assert.ok(!/fail=1/.test(zweig), 'der exit-2-Zweig setzt fail=1 — dann steht der Job und die Boards bleiben liegen');
});
test('(A) jeder ANDERE Nonzero-Code bleibt hart (der harte Zweig existiert noch)', () => {
  const g = runBlock(gateStep);
  assert.match(g, /elif \[ "\$rc" -ne 0 \]; then/, 'der harte Nonzero-Zweig ist verschwunden');
  assert.match(g, /if \[ "\$fail" -ne 0 \]; then\n\s*echo "::error::Live-Universum-Gate failed/,
    'der abschliessende exit-1-Block des Gates fehlt');
});

// ── (B) Das Bruell-Rot sitzt NICHT in der Datenkette ─────────────────────────────────
test('(B) der Bruell-Schritt steht im laufstatus-Job, NICHT im scoring-Job (sonst Zaehler-Reset)', () => {
  assert.ok(laufstatus.includes('name: Anker-Bruellen'),
    'der Bruell-Schritt steht nicht im laufstatus-Job');
  assert.ok(!scoring.includes('name: Anker-Bruellen'),
    'der Bruell-Schritt steht im scoring-Job. Dann faerbt ein Rangfolge-Riss needs.scoring.result '
    + 'auf failure, der Statusmarker meldet die DATENKETTE als kaputt und der Merge-Zaehler wird '
    + 'genullt — der Beschluss saboetiert sich selbst (Nachtrag 16.08.).');
});
test('(B) scoring reicht den Marker per Artefakt weiter (laufstatus hat einen eigenen Checkout)', () => {
  const up = schritt(daily, 'name: Upload Anker-Status');
  assert.ok(scoring.includes('name: Upload Anker-Status'), 'der Upload steht nicht im scoring-Job');
  assert.match(up, /name:\s*anchor-status/);
  assert.match(up, /path:\s*outputs\/anchor-status\.json/);
  assert.match(up, /^ {8}if:\s*always\(\)\s*$/m, 'der Upload ist nicht auf always() — bei rotem Job ginge der Marker verloren');
  const dl = schritt(daily, 'name: Anker-Status vom scoring-Job holen');
  assert.match(dl, /needs\.scoring\.result == 'success'/,
    'der Download ist nicht an einen gruenen scoring-Job gebunden — ein fehlendes Artefakt nach '
    + 'rotem scoring erzeugte sonst ein zweites, ursachenfremdes rotes X');
});

// ── (C) Reihenfolge: erst publizieren, dann bruellen ─────────────────────────────────
test('(C) der Bruell-Schritt ist der LETZTE Schritt des laufstatus-Jobs', () => {
  const namen = [...laufstatus.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1].trim());
  assert.ok(namen.length >= 5, 'zu wenige Schritte gefunden (' + namen.length + ') — der Sucher greift nicht');
  assert.match(namen[namen.length - 1], /^Anker-Bruellen/,
    'der Bruell-Schritt ist nicht der letzte Schritt. Steht etwas dahinter, wird es bei einem '
    + 'Rangfolge-Riss uebersprungen — im schlimmsten Fall die Publikation des Statusmarkers. '
    + 'Ist: ' + namen[namen.length - 1]);
  const iPub = laufstatus.indexOf('name: Statusmarker nach gh-pages veroeffentlichen');
  const iBruell = laufstatus.indexOf('name: Anker-Bruellen');
  assert.ok(iPub > 0 && iBruell > iPub, 'der Bruell-Schritt steht VOR der Marker-Publikation');
});
test('(C) der Bruell-Schritt traegt `if: always()` (sonst schweigt er nach jedem anderen Fehler)', () => {
  assert.match(bruellStep, /^ {8}if:\s*always\(\)\s*$/m);
});

// ── Der run-Block, ausgefuehrt: alle sechs Ausgaenge ─────────────────────────────────
function fahre(scoringResult, markerInhalt) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bruell-'));
  try {
    if (markerInhalt !== null) {
      fs.mkdirSync(path.join(cwd, 'outputs'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'outputs', 'anchor-status.json'), markerInhalt);
    }
    return sh(bruellRun, { cwd, env: { SCORING_RESULT: scoringResult } });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
const mk = (status, verletzungen = []) => JSON.stringify({
  schema: 'anchor-status/v1', generated_at: 'x', status,
  breached: status !== 'ok', blocked: status === 'blockiert', verletzungen, anker: [],
});

test('Lauf: alles gruen -> exit 0, kein Bruellen (die Gegenprobe gegen ein Dauer-Rot)', () => {
  const r = fahre('success', mk('ok'));
  assert.equal(r.code, 0, 'ein heiler Anker-Status faerbt den Lauf rot:\n' + r.out);
  assert.ok(!/::error::/.test(r.out), 'Fehlermeldung bei status=ok:\n' + r.out);
});
test('Lauf: Rangfolge-Riss -> exit 1 (der Lauf wird rot) und die Verletzung steht im Log', () => {
  const r = fahre('success', mk('rangfolge', ['ALAB Rang 38/103 = 35.9% > 15% in semiconductors|profitable']));
  assert.equal(r.code, 1, 'ein Rangfolge-Riss faerbt den Lauf NICHT rot — Karl sieht kein rotes X:\n' + r.out);
  assert.match(r.out, /ALAB Rang 38\/103/, 'die konkrete Verletzung steht nicht im Log — das rote X waere unlesbar');
  assert.match(r.out, /::error::DIREKTIVE 4 GERISSEN/, 'keine ::error::-Annotation — GitHub zeigt die Ursache dann nicht an');
  assert.match(r.out, /SIND ausgeliefert/, 'der Text sagt nicht, dass die Boards trotzdem raus sind — genau das muss er sagen');
});
test('Lauf: scoring war rot -> exit 0 (kein zweites, ursachenfremdes rotes X)', () => {
  const r = fahre('failure', null);
  assert.equal(r.code, 0, 'der Bruell-Schritt faerbt zusaetzlich rot, obwohl scoring schon rot war:\n' + r.out);
});
test('Lauf: scoring GRUEN aber Marker fehlt -> exit 1 (ein blinder Alarmkanal wird gemeldet)', () => {
  const r = fahre('success', null);
  assert.equal(r.code, 1, 'ein fehlender Marker nach gruenem scoring geht still durch — genau der '
    + 'stille gruene Haken auf einen nicht gemeldeten Alarm:\n' + r.out);
  assert.match(r.out, /::error::/);
});
test('Lauf: Marker meldet blockiert, scoring aber gruen -> exit 1 (Widerspruch, nie still)', () => {
  const r = fahre('success', mk('blockiert'));
  assert.equal(r.code, 1, 'der Widerspruch "Datenschaden gemeldet, trotzdem deployt" geht still durch:\n' + r.out);
});
test('Lauf: kaputtes JSON -> exit 1 statt stiller Annahme "alles ok"', () => {
  const r = fahre('success', '{ das ist kein json');
  assert.equal(r.code, 1, 'ein unlesbarer Marker geht gruen durch:\n' + r.out);
});
test('Lauf: unbekannter Status -> exit 1 (kein stiller Durchlauf eines neuen Zustands)', () => {
  const r = fahre('success', mk('voellig-neu'));
  assert.equal(r.code, 1, 'ein unbekannter Status geht gruen durch:\n' + r.out);
});

console.log(`\nbruell-kanal.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
