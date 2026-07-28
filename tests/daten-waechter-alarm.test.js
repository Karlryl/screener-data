'use strict';
/**
 * Waechter ueber die Waechter: schlagen die vier Daten-Kanarienvoegel bei Karl an?
 *
 * BEFUND (28.07.): Boersen-Abdeckung, nicht geroutete Namen, FX-Plausibilitaet und der
 * Schrumpf-Waechter melden ihre Funde per ::error:: und Exit 1 — aber jeder Schritt traegt
 * `continue-on-error`, also lief der Job weiter und endete GRUEN. Der gedachte zweite
 * Kanal existiert nicht: DISCORD_WEBHOOK ist nicht gesetzt (der Workflow sagt es an zwei
 * Stellen selbst), und Karl liest ohnehin kein Discord, sondern ausschliesslich das rote X.
 * Ein stiller Einbruch der Boersen-Abdeckung kam damit bei niemandem an.
 *
 * `continue-on-error` bleibt bewusst stehen — die Waechter schreiben ihre Baseline VOR dem
 * Drift-Check, und ein sofortiger Abbruch wuerde sie verlieren, womit sich der Alarm selbst
 * blind machte. Deshalb: erst schreiben und committen, dann einsammeln.
 *
 * Usage:  node tests/daten-waechter-alarm.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Zeilenenden vereinheitlichen: git materialisiert die Datei unter Windows mit CRLF.
// Ohne das suchen die Proben unten nach einem Zeilenumbruch und finden nichts — ein
// Falschalarm, den es nur auf Karls Rechner gibt, waehrend die CI (Linux) gruen bleibt.
const WF = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8')
  .split('\r\n').join('\n');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const WAECHTER = [
  { id: 'w_exchange', schritt: 'Watch Exchange Coverage' },
  { id: 'w_unrouted', schritt: 'Watch Unrouted Quote Share' },
  { id: 'w_fx', schritt: 'Watch FX Sanity' },
  { id: 'w_pullstats', schritt: 'Pull-Stats Check' },
];

/** Der YAML-Block eines Schritts: ab seinem Namen bis zum naechsten `- name:`. */
function block(schrittName) {
  const i = WF.indexOf('- name: ' + schrittName + '\n');
  assert.ok(i > 0, 'Schritt "' + schrittName + '" nicht gefunden');
  const bis = WF.indexOf('- name:', i + 10);
  return WF.slice(i, bis > 0 ? bis : undefined);
}

for (const w of WAECHTER) {
  check(w.schritt + ' hat eine ID und wird eingesammelt', () => {
    assert.ok(block(w.schritt).includes('id: ' + w.id),
      'ohne ID kann der Sammel-Schritt sein Ergebnis nicht lesen');
    assert.ok(WF.includes('steps.' + w.id + '.outcome'),
      'die ID ist vergeben, aber niemand fragt ihr Ergebnis ab — der Alarm bleibt stumm');
  });
}

check('der Sammel-Schritt faerbt den Lauf wirklich rot', () => {
  const b = block('Daten-Waechter einsammeln (rotes X)');
  assert.ok(/::error::/.test(b), 'muss ::error:: schreiben, nicht ::warning::');
  assert.ok(/exit 1/.test(b), 'muss mit exit 1 enden');
  assert.ok(/if: always\(\)/.test(b),
    'ohne always() wird er uebersprungen, sobald ein frueherer Schritt scheitert — genau dann wird er gebraucht');
});

check('er laeuft NACH dem Commit, damit die Baseline erhalten bleibt', () => {
  // Die Waechter schreiben ihre Vergleichsbasis vor dem Drift-Check. Bricht der Job
  // vorher ab, fehlt dem naechsten Lauf der Vergleichsstand — der Alarm macht sich selbst
  // blind. Deshalb ist die Reihenfolge Teil des Entwurfs, kein Zufall.
  assert.ok(WF.indexOf('- name: Daten-Waechter einsammeln') > WF.indexOf('- name: Commit Snapshots'),
    'der Sammler steht vor dem Commit — dann geht die Baseline bei Alarm verloren');
});

check('kein Waechter behaelt continue-on-error OHNE eingesammelt zu werden', () => {
  // Der eigentliche Regressions-Schutz: wer morgen einen fuenften Kanarienvogel mit
  // continue-on-error dazustellt und das Einsammeln vergisst, baut denselben stummen
  // Alarm noch einmal. Diese Probe faengt genau das.
  const namen = [...WF.matchAll(/- name: (Watch [^\n]+)\n/g)].map((m) => m[1]);
  assert.ok(namen.length >= 3, 'die Watch-Schritte wurden umbenannt — Probe anpassen');
  for (const n of namen) {
    const b = block(n);
    if (!/continue-on-error:\s*true/.test(b)) continue;
    const m = b.match(/id:\s*(\S+)/);
    assert.ok(m, 'Schritt "' + n + '" schluckt Fehler per continue-on-error, hat aber keine ID');
    assert.ok(WF.includes('steps.' + m[1] + '.outcome'),
      'Schritt "' + n + '" schluckt Fehler, aber sein Ergebnis wird nirgends eingesammelt — stummer Alarm');
  }
});

check('der Schrumpf-Waechter meldet Drift jetzt als Fehler, nicht als Notiz', () => {
  // ⚠ Diese Probe pruefte zuerst, ob der Satz "never fail workflow; alert is enough"
  // im Quelltext FEHLT — und wurde sofort rot, weil der neue Kommentar den alten Satz
  // ZITIERT, um die Aenderung zu erklaeren. Ein Waechter, der ein Schreibmuster sucht
  // statt die Sache, faellt auf jede Erklaerung herein. Jetzt werden die Kommentare
  // entfernt und das VERHALTEN geprueft.
  const roh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-pull-stats.js'), 'utf8');
  const code = roh.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Der Drift-Zweig steht zwischen dem Discord-Versand und dem Ende von main().
  const i = code.indexOf('postDiscord(msg)');
  assert.ok(i > 0, 'der Drift-Zweig wurde umgebaut — Probe anpassen');
  const rest = code.slice(i, i + 400);
  assert.ok(/return\s+1\s*;/.test(rest),
    'der Drift-Zweig gibt nicht 1 zurueck — der Lauf bliebe gruen, und Discord ist nicht konfiguriert');
  assert.ok(/::error::Pull-Stats-Drift/.test(roh), 'der Drift-Fall muss ::error:: schreiben');
  assert.ok(/ALLOW_PULL_DRIFT/.test(code), 'das Ventil fuer bekannte, gewollte Einbrueche muss bleiben');
});

console.log('\ndaten-waechter-alarm: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
