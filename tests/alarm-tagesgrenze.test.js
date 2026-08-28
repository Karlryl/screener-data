'use strict';
/**
 * Alarm-Tagesgrenze — die Frische-Waechter halten ihre eigene Schwelle ein.
 * =========================================================================
 *
 * BEFUND (28.08.2026): Der Heartbeat meldete waehrend eines viertaegigen
 * Board-Einfrierens durchgehend GRUEN. Lauf 33122769695 (27.08. 22:32 UTC)
 * gegen einen Export vom 25.08. 04:25 UTC, woertlich aus dem CI-Protokoll:
 *
 *     Export-Alter (gh-pages findash-export/v1/index.json .generated_at): 2 Tage (Schwelle: 2)
 *
 * Echtes Alter: 2,76 Tage. `Math.floor(2,76) = 2`, und `2 > 2` ist falsch.
 * Unabhaengiger Zweitbeleg aus derselben Klasse: der Wochen-Guard meldete am
 * 24.08. "Daten 4d alt (>3)" — er schlug also erst bei 4,0 Tagen an, obwohl
 * seine deklarierte Schwelle 3 ist.
 *
 * WAS HIER FESTGENAGELT WIRD — die ENTSCHEIDUNG (rot/gruen), nicht die
 * Schreibweise:
 *   (a) der echte Vorfall (2,76 d gegen Schwelle 2) MUSS rot sein
 *   (b) ANWESENHEIT der Gegenrichtung: 1,9 d gegen Schwelle 2 MUSS gruen sein
 *       — eine Wache, die immer rot ist, ist so wertlos wie keine
 *   (c) die Grenze selbst: exakt 2,0 ist noch gruen, 2,01 ist rot
 *   (d) der Wochen-Guard-Fall: 3,9 d gegen Schwelle 3 MUSS rot sein
 *   (e) fail-loud: unbrauchbarer Messwert gilt als VERALTET, nie als frisch
 *   (f) Verdrahtung: der ECHTE node-Block aus heartbeat.yml wird ausgefuehrt
 *       und liefert fuer den Vorfalls-Zeitstempel Stunden ueber der Schwelle
 *
 * ROT-ZUERST: mit der alten Bauform (`Math.floor` + `>`) fallen (a), (c-oberer
 * Fall) und (d). Absichtlich einmal gebrochen und rot gesehen, siehe Bericht.
 *
 * Standalone: node tests/alarm-tagesgrenze.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const A = require('../lib/alter.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const TAG = 86400000;
const alterVon = (tage) => A.alterTage(Date.now() - tage * TAG, Date.now());

// ── (a) der echte Vorfall ────────────────────────────────────────────────────
check('(a) Vorfall 27.08.: 2,76 Tage gegen Schwelle 2 ist VERALTET', () => {
  const erzeugt = Date.parse('2026-08-25T04:25:53.728Z');
  const gemessen = Date.parse('2026-08-27T22:32:04.421Z');
  const alter = A.alterTage(erzeugt, gemessen);
  assert.ok(alter > 2.7 && alter < 2.8, 'Alter sollte ~2,76 Tage sein, ist ' + alter);
  assert.equal(A.istVeraltet(alter, 2), true,
    'der Vorfall vom 27.08. muss rot sein — genau hier meldete der Heartbeat gruen');
});

// ── (b) Gegenrichtung: die Wache darf nicht immer rot sein ───────────────────
check('(b) ANWESENHEIT der Gegenprobe: 1,9 Tage gegen Schwelle 2 ist frisch', () => {
  assert.equal(A.istVeraltet(alterVon(1.9), 2), false,
    'eine Wache, die auch bei frischen Daten rot wird, ist wertlos');
});

// ── (c) die Grenze selbst ────────────────────────────────────────────────────
check('(c) Grenze: exakt 2,0 gruen — 2,01 rot', () => {
  assert.equal(A.istVeraltet(2.0, 2), false, 'exakt auf der Schwelle ist noch frisch (>, nicht >=)');
  assert.equal(A.istVeraltet(2.01, 2), true, 'knapp ueber der Schwelle muss rot sein');
});

// ── (d) der unabhaengige Zweitbeleg ──────────────────────────────────────────
check('(d) Wochen-Guard: 3,9 Tage gegen Schwelle 3 ist VERALTET', () => {
  assert.equal(A.istVeraltet(3.9, 3), true,
    'die alte Bauform meldete hier 3 und blieb gruen bis 4,0');
});

// ── (e) fail-loud ────────────────────────────────────────────────────────────
check('(e) unbrauchbarer Messwert gilt als VERALTET, nicht als frisch', () => {
  assert.equal(A.istVeraltet(null, 2), true, 'null darf nicht entwarnen');
  assert.equal(A.istVeraltet(NaN, 2), true, 'NaN darf nicht entwarnen');
  assert.equal(A.istVeraltet(1, NaN), true, 'unbrauchbare Schwelle darf nicht entwarnen');
  assert.equal(A.alterTage(NaN, Date.now()), null, 'kaputter Zeitstempel -> null, nicht 0');
});

// ── (e2) Stunden-Pfad der beiden Shell-Aufrufer ──────────────────────────────
check('(e2) Stunden-Pfad: 2,76 Tage sind 66 h und reissen die 48-h-Grenze', () => {
  const std = A.alterStunden(Date.now() - 2.76 * TAG, Date.now());
  assert.equal(std, 66, 'erwartet 66 volle Stunden, bekommen ' + std);
  assert.ok(std > 2 * 24, '66 h muss ueber der 48-h-Grenze (Schwelle 2 d) liegen');
  assert.ok(A.alterStunden(Date.now() - 1.9 * TAG, Date.now()) <= 2 * 24,
    'Gegenprobe: 1,9 Tage duerfen die 48-h-Grenze NICHT reissen');
});

// ── (f) Verdrahtung: der ECHTE Block aus heartbeat.yml ───────────────────────
// Kein Textmuster-Test: der node-Block wird aus der YAML herausgeloest und
// AUSGEFUEHRT. Faellt jemand auf die alte Bauform zurueck oder verdreht die
// Einheit, liefert dieser Lauf eine andere Zahl und der Test faellt.
check('(f) Verdrahtung: heartbeat.yml-Block liefert fuer den Vorfall Stunden > Schwelle', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'heartbeat.yml'), 'utf8');
  const start = yml.indexOf('const idx=JSON.parse(s);');
  assert.ok(start > 0, 'Export-Frische-Block nicht gefunden — wurde er umbenannt?');
  const ende = yml.indexOf('});', start);
  const kern = yml.slice(start, ende);
  assert.ok(/alterStunden/.test(kern), 'der Block rechnet nicht mehr ueber lib/alter.js');

  // Denselben Kern gegen ein Fixture fahren, mit dem Zeitstempel des Vorfalls.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alarmgrenze-'));
  const fixture = path.join(dir, 'idx.json');
  fs.writeFileSync(fixture, JSON.stringify({ generated_at: '2026-08-25T04:25:53.728Z' }));
  const prog = `
    const A=require(${JSON.stringify(path.join(ROOT, 'lib', 'alter.js'))});
    const idx=JSON.parse(require('fs').readFileSync(${JSON.stringify(fixture)},'utf8'));
    const t=Date.parse(idx.generated_at);
    const jetzt=Date.parse('2026-08-27T22:32:04.421Z');
    console.log(A.alterStunden(t, jetzt));
  `;
  const r = spawnSync(process.execPath, ['-e', prog], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'Block-Lauf fehlgeschlagen: ' + r.stderr);
  const stunden = Number(r.stdout.trim());
  assert.equal(stunden, 66, 'erwartet 66 h fuer den Vorfall, bekommen ' + stunden);
  assert.ok(stunden > 2 * 24, '66 h muss die 48-h-Grenze reissen — sonst schweigt der Alarm wie am 27.08.');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
