'use strict';
/**
 * tests/dt2-watchlist-schreibbeweis.test.js — Waechter fuer DT-2 (Verifikation
 * Exchange-Kanal 2026-08-04, Lauf 30788278952 / prep-Job 91606250192).
 *
 * BEFUND: der Schritt "Verify Watchlist Sanity" las nach dem 20-Minuten-Timeout des
 * Refresh-Schritts die ALTE watchlist.json aus dem Checkout, meldete "watchlist size:
 * 15300" und ging GRUEN. Er beantwortet "sind es genug Namen?" und sieht dabei aus, als
 * beantworte er "hat der Refresh funktioniert?". Ein Nicht-Schreiben war von einem
 * erfolgreichen Lauf nicht zu unterscheiden.
 *
 * FIX: Schreib-Beweis. mtime vor dem Refresh (eigener Schritt) gegen mtime danach,
 * kombiniert mit dem Ausgang des Refresh-Schritts. Die Kombination ist noetig, weil
 * refresh-universe.js bei "nichts Neues, nichts repariert" bewusst NICHT schreibt —
 * eine unveraenderte mtime allein ist also legitim.
 *
 * Geprueft wird das VERHALTEN: der run-Block wird aus der Workflow-Datei geschnitten und
 * mit echtem watchlist.json in einem Temp-Verzeichnis per sh ausgefuehrt (gleiche Bauart
 * wie tests/t564-datenkanal.test.js und tests/r5-sk-002-fx-frische-drei-zustaende.test.js).
 * Ein Nachbau wuerde genau die Abweichung nicht finden, um die es geht.
 *
 * Run: node tests/dt2-watchlist-schreibbeweis.test.js
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
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message || e)); }
}

/** Den Rumpf EINES benannten Schritts schneiden (Ende: naechster Schritt ODER Job-Ende). */
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

function shBinaer() {
  const kandidaten = ['sh', 'C:/Program Files/Git/usr/bin/sh.exe', 'C:/Program Files (x86)/Git/usr/bin/sh.exe'];
  for (const k of kandidaten) {
    try { execFileSync(k, ['-c', 'exit 0'], { stdio: 'ignore' }); return k; } catch (e) { /* naechster */ }
  }
  return assert.fail('keine ausfuehrbare sh gefunden — dieser Waechter kann das Verhalten des '
    + 'Sanity-Gates dann nicht messen. Ein stiller Skip waere hier der schlimmste Ausgang: die '
    + 'Wache saehe aus wie bestanden.');
}

/**
 * Die Git-sh unter Windows startet OHNE ihr eigenes usr/bin auf dem PATH — `date` und
 * `sha256sum` fehlen dann. Das ist keine Kleinigkeit: der Gate rechnet still mit einer
 * leeren NACHHER_MTIME weiter und der Waechter waere gruen geworden, ohne irgendetwas
 * gemessen zu haben (genau die Klasse Fehler, gegen die er gebaut ist). Also PATH ergaenzen
 * UND die Verfuegbarkeit hart pruefen.
 */
const SH = shBinaer();
const SH_ENV = (() => {
  const env = Object.assign({}, process.env);
  if (/Git[\\/](usr[\\/])?bin[\\/]sh\.exe$/i.test(SH)) {
    env.PATH = path.dirname(SH) + path.delimiter + (env.PATH || env.Path || '');
  }
  return env;
})();
try {
  execFileSync(SH, ['-c', 'command -v date >/dev/null && command -v node >/dev/null'],
    { env: SH_ENV, stdio: 'ignore' });
} catch (e) {
  assert.fail('in der gefundenen sh (' + SH + ') fehlt `date` oder `node` auf dem PATH. Der Gate-Block '
    + 'wuerde dann mit leeren Werten durchlaufen und dieser Waechter waere gruen, ohne etwas zu messen.');
}

const SANITY = () => schritt(daily, 'name: Verify Watchlist Sanity');
const REFERENZ = () => schritt(daily, 'name: Watchlist-Referenz vor dem Refresh (DT-2)');

/** Den run-Block eines Schritts mit gesetzten GitHub-Ausdruecken ausfuehrbar machen. */
function runBlock(section, ersetzungen) {
  const i = section.indexOf('run: |');
  assert.ok(i >= 0, 'kein `run: |` im Schritt');
  let block = section.slice(i + 'run: |'.length).split('\n').map((z) => z.replace(/^ {10}/, '')).join('\n');
  for (const [re, wert] of ersetzungen) block = block.replace(re, wert);
  assert.ok(!block.includes('${{'),
    'im ausgefuehrten Block steht noch ein unersetzter GitHub-Ausdruck — dann misst dieser Waechter '
    + 'etwas anderes als der Runner ausfuehrt: '
    + JSON.stringify((block.match(/\$\{\{[^}]*\}\}/) || [''])[0]));
  return block;
}

/** Ein Arbeitsverzeichnis mit echter watchlist.json (n Zeilen). */
function arbeitsordner(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt2-'));
  const stocks = Array.from({ length: n }, (_, i) => ({ ticker: 'T' + i, added_via: 'test' }));
  fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ stocks }, null, 2));
  return dir;
}

function fahre(block, dir) {
  try {
    const out = execFileSync(SH, ['-c', block],
      { cwd: dir, env: SH_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

/** Die mtime GENAUSO lesen, wie der Gate es tut — keine JS-Nachbildung. */
function mtimeWieDerGate(dir) {
  const m = execFileSync(SH, ['-c', 'date -r watchlist.json +%s'],
    { cwd: dir, env: SH_ENV, encoding: 'utf8' }).trim();
  assert.match(m, /^\d+$/, 'die mtime liess sich nicht so lesen, wie der Gate es tut ("' + m + '") — dann '
    + 'vergleicht dieser Waechter leere Werte miteinander und ist gruen, ohne etwas zu pruefen.');
  return m;
}

function lauf(dir, vorherMtime, refreshAusgang) {
  const block = runBlock(SANITY(), [
    [/\$\{\{\s*steps\.watchlist_vorher\.outputs\.mtime\s*\}\}/g, vorherMtime],
    [/\$\{\{\s*steps\.refresh_universe\.outcome\s*\}\}/g, refreshAusgang],
  ]);
  return fahre(block, dir);
}

// ── Verdrahtung: ohne Referenz-Schritt gibt es keinen Beweis ─────────────────────
test('DT-2: der Referenz-Schritt liegt VOR dem Refresh und liefert mtime + sha', () => {
  const iRef = daily.indexOf('- name: Watchlist-Referenz vor dem Refresh (DT-2)');
  const iRefresh = daily.indexOf('- name: Refresh Universe');
  const iSanity = daily.indexOf('- name: Verify Watchlist Sanity');
  assert.ok(iRef >= 0, 'der Referenz-Schritt fehlt — dann liest der Gate wieder nur die Datei aus dem Checkout.');
  assert.ok(iRef < iRefresh, 'die Referenz wird NACH dem Refresh genommen — dann ist sie keine Referenz, '
    + 'sondern das Ergebnis (Reihenfolge Referenz=' + iRef + ' Refresh=' + iRefresh + ').');
  assert.ok(iRefresh < iSanity, 'der Sanity-Gate liegt nicht mehr nach dem Refresh.');
  const ref = REFERENZ();
  assert.match(ref, /^\s*id:\s*watchlist_vorher\s*$/m,
    'der Referenz-Schritt hat keine id — ohne sie kommt der Gate nie an den Vorher-Stand heran.');
  assert.match(ref, /echo "mtime=/, 'die Referenz gibt keine mtime als Schritt-Ausgang heraus.');
});

test('DT-2: der Gate verbraucht GENAU diese Referenz und den Refresh-Ausgang', () => {
  const s = SANITY();
  assert.match(s, /steps\.watchlist_vorher\.outputs\.mtime/,
    'der Gate liest die Vorher-mtime nicht — dann kann er ein Nicht-Schreiben nicht sehen (der Befund).');
  assert.match(s, /steps\.refresh_universe\.outcome/,
    'der Gate liest den Ausgang des Refresh-Schritts nicht. Ohne ihn ist eine unveraenderte Datei nicht '
    + 'vom legitimen Fall "nichts Neues, nichts repariert" zu unterscheiden — refresh-universe.js '
    + 'schreibt dann bewusst gar nicht.');
});

// ── Verhalten: unveraendert + kaputter Refresh -> LAUT ───────────────────────────
test('DT-2: unveraenderte Datei nach gescheitertem Refresh -> ::error:: (der 03.08.-Fall)', () => {
  const dir = arbeitsordner(250);
  for (const ausgang of ['failure', 'cancelled', '']) {
    const r = lauf(dir, mtimeWieDerGate(dir), ausgang);
    assert.match(r.out, /::error::KEIN SCHREIB-BEWEIS/,
      'Ausgang "' + ausgang + '": der Gate meldet nichts, obwohl watchlist.json unveraendert ist und der '
      + 'Refresh nicht sauber durchlief. GENAU SO ging er am 03.08. mit "watchlist size: 15300" gruen '
      + 'durch, nachdem der Refresh in sein 20-Minuten-Timeout gelaufen war. Ausgabe: ' + r.out.trim());
    assert.match(r.out, /Stand des VORTAGS/, 'die Meldung sagt nicht, was die Zahl wirklich ist.');
    // Bewusst KEIN exit 1: ein fallender prep-Job reisst pull+merge mit (siehe Kommentar am
    // Schritt). Das rote X traegt der Job entdeckungs-waechter.
    assert.equal(r.code, 0, 'Ausgang "' + ausgang + '": der Gate beendet den prep-Job hart — dann reisst '
      + 'er `pull` (needs: prep) und `merge` mit und kostet den ganzen Tag, obwohl das Universum von '
      + 'gestern gueltig ist. Genau die Abwaegung, die das continue-on-error am Refresh-Schritt traegt.');
  }
});

// ── Verhalten: die drei stillen Faelle (Falsch-Rot-Proben) ──────────────────────
test('DT-2: unveraenderte Datei nach SAUBEREM Refresh -> still (legitimer Nicht-Schreib-Fall)', () => {
  const dir = arbeitsordner(250);
  const r = lauf(dir, mtimeWieDerGate(dir), 'success');
  assert.equal(r.code, 0, 'ein legitimer "nichts Neues"-Lauf wird rot: ' + r.out.trim());
  assert.ok(!/::error::/.test(r.out),
    'refresh-universe.js schreibt bei "nichts Neues, nichts repariert" bewusst nicht (Zweig "Universe '
    + 'unchanged"). Wer das als Ausfall meldet, baut einen Dauer-Falschalarm: ' + r.out.trim());
  assert.match(r.out, /bestaetigter Stand/, 'der Gate sagt nicht, warum die unveraenderte Datei hier in Ordnung ist.');
});

test('DT-2: geschriebene Datei -> still, egal wie der Refresh ausging (Gegenprobe)', () => {
  const dir = arbeitsordner(250);
  const alt = String(Number(mtimeWieDerGate(dir)) - 3600);   // Referenz eine Stunde aelter
  for (const ausgang of ['success', 'failure']) {
    const r = lauf(dir, alt, ausgang);
    assert.equal(r.code, 0, 'eine neu geschriebene Watchlist macht den Gate rot: ' + r.out.trim());
    assert.ok(!/::error::/.test(r.out),
      'Ausgang "' + ausgang + '": die Datei WURDE neu geschrieben (mtime hat sich bewegt) — ein Alarm '
      + 'hier waere falsch. Ausgabe: ' + r.out.trim());
    assert.match(r.out, /neu geschrieben/, 'der Schreib-Beweis wird nicht protokolliert.');
  }
});

test('DT-2: ohne Vorher-Referenz bleibt der Gate still (erster Lauf, keine Datei im Checkout)', () => {
  const dir = arbeitsordner(250);
  const r = lauf(dir, '', 'success');
  assert.equal(r.code, 0, 'ohne Referenz wird der Gate rot: ' + r.out.trim());
  assert.ok(!/::error::/.test(r.out), 'ohne Referenz ist kein Vergleich moeglich — ein Alarm waere geraten.');
});

// ── Der alte Gate darf durch den Umbau nicht schwaecher werden ──────────────────
test('DT-2: die 200er-Untergrenze bleibt ein HARTER Stop', () => {
  const dir = arbeitsordner(199);
  const r = lauf(dir, mtimeWieDerGate(dir), 'success');
  assert.equal(r.code, 1, 'eine degenerierte Watchlist (199 Namen) laeuft durch — der Schreib-Beweis hat '
    + 'die bestehende Reissleine F-CI-003 entschaerft: ' + r.out.trim());
  assert.match(r.out, /::error::/, 'die Untergrenze meldet sich nicht mehr.');
});

test('DT-2: fehlende watchlist.json bleibt ein HARTER Stop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt2-leer-'));
  const block = runBlock(SANITY(), [
    [/\$\{\{\s*steps\.watchlist_vorher\.outputs\.mtime\s*\}\}/g, ''],
    [/\$\{\{\s*steps\.refresh_universe\.outcome\s*\}\}/g, 'success'],
  ]);
  const r = fahre(block, dir);
  assert.equal(r.code, 1, 'eine fehlende watchlist.json laeuft durch: ' + r.out.trim());
  assert.match(r.out, /is missing after refresh/, 'die Meldung fuer die fehlende Datei ist weg.');
});

console.log('\ndt2-watchlist-schreibbeweis.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
