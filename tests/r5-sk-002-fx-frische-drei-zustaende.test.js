'use strict';
/**
 * R5-SK-002 (Block 5, Verifikation 2026-08-03) — das FX-Frische-Gate konnte den
 * schlimmsten Fall nicht sehen.
 *
 * BEFUND: `fetchedAt: null` (refresh-fx.js schrieb das bei Totalausfall ohne
 * frueheren Stempel) lief im Gate durch `d.fetchedAt ? Date.parse(...) : NaN` in
 * den Fail-open-Zweig: Alter = 0 Tage, gruen. Genau die Lage, in der KEIN einziger
 * Kurs abrufbar war, meldete "frisch". Das ist nicht dasselbe wie ein fehlender
 * Schluessel (Altdatei/Bootstrap, fail-open korrekt) und nicht dasselbe wie eine
 * fehlende Datei (Warnung, pull-yahoo hat harte Fallback-Kurse).
 *
 * Dieser Waechter fuehrt den EINGEBETTETEN node-Einzeiler aus der Workflow-Datei
 * selbst aus (herausgeschnitten, nicht nachgebaut) — ein Nachbau wuerde genau die
 * Abweichung nicht finden, um die es geht.
 *
 * Standalone-Runner, kein Netz: node tests/r5-sk-002-fx-frische-drei-zustaende.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'daily-pull.yml'), 'utf8');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Der Text des benannten Schritts — nicht die ganze Datei (sonst haelt ein */
/*  zweites Vorkommen den Waechter gruen, waehrend genau diese Stelle kippt).  */
function schritt(name, endeName) {
  const s = YML.indexOf('- name: ' + name);
  assert.ok(s >= 0, 'Schritt nicht gefunden: ' + name);
  const e = YML.indexOf('- name: ' + endeName, s + 1);
  assert.ok(e > s, 'Ende-Schritt nicht gefunden: ' + endeName);
  return YML.slice(s, e);
}

const GATE = schritt('Verify FX-Rates Freshness', 'Pull Insider Form-4 (daily)');

/** Der eingebettete node-Einzeiler, so wie CI ihn ausfuehrt. */
function einzeiler() {
  const m = GATE.match(/node -e "([^"]+)"/);
  assert.ok(m, 'kein `node -e "..."` im FX-Frische-Schritt gefunden');
  return m[1];
}

/** Fuehrt den Einzeiler in einem Temp-Verzeichnis mit der gegebenen Datei aus. */
function laufMit(inhalt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r5fx-'));
  if (inhalt !== null) fs.writeFileSync(path.join(dir, 'fx-rates.json'), inhalt);
  try {
    return execFileSync(process.execPath, ['-e', einzeiler()],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ── Der Einzeiler muss ueberhaupt einzeln ausfuehrbar sein ──────────────────
check('der eingebettete Einzeiler ist ohne Shell-Einsetzungen ausfuehrbar (sonst nicht pruefbar)', () => {
  const z = einzeiler();
  assert.ok(!/\$\(/.test(z), 'Kommando-Einsetzung im Einzeiler — dann prueft dieser Waechter nur einen Nachbau');
  assert.ok(!/\$now\b/.test(z), 'Shell-Variable $now im Einzeiler — dann prueft dieser Waechter nur einen Nachbau');
});

// ── Die drei Zustaende ──────────────────────────────────────────────────────
check('Zustand ROT: fetchedAt ist AUSDRUECKLICH null', () => {
  assert.equal(laufMit(JSON.stringify({ fetchedAt: null, rates: { USD: 1 } })), 'NULL',
    'genau dieser Fall lief bisher als "frisch" durch');
});

check('Zustand fail-open: der Schluessel fehlt ganz (Altdatei/Bootstrap)', () => {
  assert.equal(laufMit(JSON.stringify({ rates: { USD: 1 } })), 'KEIN_STEMPEL');
});

check('Zustand fail-open: die Datei ist unlesbar', () => {
  assert.equal(laufMit('{ kaputt'), 'KEIN_STEMPEL');
});

check('Zustand fail-open: fetchedAt ist unparsbarer Text (wie bisher, kein neuer Rot-Fall)', () => {
  assert.equal(laufMit(JSON.stringify({ fetchedAt: 'gestern' })), 'KEIN_STEMPEL');
});

check('Zustand gruen: ein echter Stempel kommt als Sekunden zurueck', () => {
  const iso = '2026-08-01T00:00:00.000Z';
  assert.equal(laufMit(JSON.stringify({ fetchedAt: iso })), String(Math.floor(Date.parse(iso) / 1000)));
});

// ── Die Verzweigung im Schritt selbst ───────────────────────────────────────
/**
 * Der bash-Zweig zum genannten Zustand — der Variablenname kommt aus der
 * Zuweisung selbst, damit der Waechter am Zweig haengt und nicht an einer
 * Schreibweise (und nicht an einem gleichlautenden Wort im Kommentar darueber).
 */
function zustandsZweig(zustand, ende) {
  const v = GATE.match(/(\w+)=\$\(node -e/);
  assert.ok(v, 'die Zustands-Zuweisung `<var>=$(node -e ...)` fehlt');
  const re = new RegExp('if \\[ "\\$' + v[1] + '" = "' + zustand + '" \\]; then([\\s\\S]*?)\\n\\s*' + ende + '\\b');
  const m = GATE.match(re);
  assert.ok(m, 'kein bash-Zweig fuer den Zustand ' + zustand + ' gefunden');
  return m[1];
}

check('NULL macht den Schritt hart rot (::error:: + exit 1)', () => {
  const zweig = zustandsZweig('NULL', 'fi');
  assert.match(zweig, /::error::/, 'der null-Fall meldet keinen Fehler');
  assert.match(zweig, /exit 1/, 'der null-Fall beendet den Schritt nicht');
});

check('KEIN_STEMPEL bleibt fail-open (kein exit 1), meldet aber, dass nicht gemessen werden konnte', () => {
  const zweig = zustandsZweig('KEIN_STEMPEL', 'else');
  assert.match(zweig, /::warning::/, 'ein nicht messbarer Zustand darf nicht voellig stumm bleiben');
  assert.ok(!/exit 1/.test(zweig), 'fail-open darf nicht rot werden');
});

check('die bestehenden Alters-Schwellen (30d hart, 7d Warnung) sind unveraendert da', () => {
  assert.match(GATE, /age_days" -gt 30/);
  assert.match(GATE, /age_days" -gt 7/);
});

check('fehlende Datei bleibt eine blosse Warnung (pull-yahoo hat harte Fallback-Kurse)', () => {
  const zweig = GATE.slice(GATE.lastIndexOf('else'));
  assert.match(zweig, /fx-rates\.json missing/);
  assert.ok(!/exit 1/.test(zweig), 'eine fehlende Datei darf den Tageslauf nicht kippen');
});

// ── Der Erzeuger: bei Totalausfall ohne Vorstand gar nicht erst schreiben ───
const FX = require('../scripts/refresh-fx.js');

check('refresh-fx: bei Totalausfall OHNE frueheren Stempel wird NICHT geschrieben', () => {
  assert.equal(typeof FX.darfSchreiben, 'function', 'die Schreib-Entscheidung ist nicht pruefbar herausgezogen');
  assert.equal(FX.darfSchreiben(false, null), false, 'genau hier entstand das fetchedAt:null');
});

check('refresh-fx: alle anderen Faelle schreiben weiter wie bisher', () => {
  assert.equal(FX.darfSchreiben(true, null), true, 'erster erfolgreicher Lauf ueberhaupt');
  assert.equal(FX.darfSchreiben(true, '2026-08-01T00:00:00.000Z'), true, 'normaler Lauf');
  assert.equal(FX.darfSchreiben(false, '2026-08-01T00:00:00.000Z'), true,
    'Fehl-Lauf MIT Vorstand muss weiter schreiben — der eingefrorene Stempel ist genau das Alterssignal');
});

check('refresh-fx: die Entscheidung faellt VOR dem Schreiben, nicht danach', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'refresh-fx.js'), 'utf8');
  const iGuard = src.indexOf('darfSchreiben(anySuccess');
  const iWrite = src.indexOf('writeFileAtomic(outPath');
  assert.ok(iGuard > 0, 'main() benutzt darfSchreiben() gar nicht — die Funktion waere dann nur Test-Deko');
  assert.ok(iWrite > iGuard, 'der Schreibvorgang steht vor der Pruefung');
});

console.log('\nGeprueft: Schritt "Verify FX-Rates Freshness" in .github/workflows/daily-pull.yml '
  + '(eingebetteter node-Einzeiler an 5 Fixtures ausgefuehrt + die drei bash-Zweige) '
  + 'und scripts/refresh-fx.js (darfSchreiben-Wahrheitstabelle + Einbau-Reihenfolge).');
console.log('r5-sk-002: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
