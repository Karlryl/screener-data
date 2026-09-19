// Waechter fuer zwei Loecher, die am 19.09.2026 beide an einem einzigen Ziel-Pull auffielen:
//
//  (1) Ein Lauf ueber eine 16-Namen-Liste loeschte das committete _manifest.json und schrieb
//      seine eigene Bilanz hinein (n_total 21728 -> 16). coverage-gate, Merge und Scoring
//      lesen dieses Feld als Tageswahrheit.
//  (2) Der Preis-Schnellpfad schrieb marketCap.value und liess marketCap.asOf stehen. Die
//      16 GBp-Beine trugen deshalb August-Stempel auf Werten, die von diesem Weg kamen —
//      ein Stempel, der nicht mitgefuehrt wird, luegt, und die Alters-Diagnose lief in die
//      falsche Richtung.
//
// Die Regel wird AUSGEFUEHRT, nicht nachgebaut (Muster parseVollPullTicker).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { istTeilmengenLauf, MANIFEST_SUBSET_MIN_SHARE } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('FAIL   ' + name); console.log('       ' + e.message); fail++; }
}

check('der Fall vom 19.09.: 16 Namen gegen ein Manifest mit 16046 -> Teilmenge', () => {
  assert.strictEqual(istTeilmengenLauf(16, 16046), true);
});

check('der volle Tageslauf ist KEINE Teilmenge (Gegenrichtung, sonst schuetzt die Regel nichts)', () => {
  assert.strictEqual(istTeilmengenLauf(16046, 16046), false);
  assert.strictEqual(istTeilmengenLauf(21728, 21728), false);
});

check('die Schwelle liegt genau bei ' + MANIFEST_SUBSET_MIN_SHARE + ' und ist beidseitig scharf', () => {
  const bekannt = 1000;
  assert.strictEqual(istTeilmengenLauf(bekannt * MANIFEST_SUBSET_MIN_SHARE, bekannt), false,
    'exakt auf der Schwelle ist noch KEINE Teilmenge');
  assert.strictEqual(istTeilmengenLauf(bekannt * MANIFEST_SUBSET_MIN_SHARE - 1, bekannt), true,
    'einen Namen darunter schon');
});

check('ohne brauchbaren Nenner schuetzt die Regel nichts (kein/kaputtes Manifest)', () => {
  for (const bekannt of [undefined, null, 0, -5, NaN, 'viele']) {
    assert.strictEqual(istTeilmengenLauf(16, bekannt), false, 'Nenner ' + String(bekannt));
  }
});

// Review 19.09. (KRITISCH), und der Test hatte den Fehler VORGESCHRIEBEN: hier stand
// `istTeilmengenLauf(0, 16046) === false`, also "die leere Liste ist kein Teilmengen-Lauf".
// Damit war der Maximalschaden — Watchlist abgeschnitten oder leer gefiltert, Tagesmanifest
// geloescht und mit n_total 0 ueberschrieben — als richtiges Verhalten festgeschrieben.
check('die LEERE Liste ist der Maximalschaden, nicht die Ausnahme', () => {
  assert.strictEqual(istTeilmengenLauf(0, 16046), true,
    'null Ticker sprechen nie fuer ein Universum von 16046');
  assert.strictEqual(istTeilmengenLauf(0, 0), false,
    'ohne Nenner gibt es nichts zu schuetzen — auch bei leerer Liste nicht');
  assert.strictEqual(istTeilmengenLauf(-1, 16046), false,
    'eine negative Anzahl ist kein Lauf, sondern ein Aufrufer-Fehler');
});

// Review 19.09. (HOCH): der Umgehungsfall braucht eine eigene Spur. Faellt das Altmanifest
// als Eingabe aus, wird der Schutz uebersprungen — das darf im Log nicht aussehen wie ein
// gewoehnlicher Loeschvorgang.
check('unlesbares Altmanifest hinterlaesst eine WARN-Spur, nicht nur ein INFO', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const i = src.indexOf('const vorher = JSON.parse(fs.readFileSync(manifestPath');
  assert.ok(i > 0, 'die Lesestelle des Altmanifests existiert noch — sonst ist dieser Test blind');
  const block = src.slice(i, i + 1200);
  assert.ok(/catch \(e\) \{[\s\S]{0,800}?_log\('WARN'/.test(block),
    'der catch um das Altmanifest schluckt ohne jede Log-Spur — genau der Befund vom 19.09.');
  assert.ok(/UMGANGEN/.test(block), 'die WARN-Zeile benennt die Umgehung nicht');
});

// Review 19.09. (NIEDRIG, umgedreht): das `||` liess die alte Herkunft auf einem Wert stehen,
// den gerade der Quote-Weg geschrieben hatte.
check('Schnellpfad: wer marketCap.value schreibt, schreibt auch die Herkunft neu', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const i = src.indexOf('existing.marketCap.value = q.marketCap * tradingAggFactor;');
  const danach = src.slice(i, i + 900);
  assert.ok(/existing\.marketCap\.source = 'yahoo_quote';/.test(danach),
    'die Herkunft wird nicht neu gesetzt');
  assert.ok(!/existing\.marketCap\.source = existing\.marketCap\.source \|\|/.test(danach),
    'das || ist zurueck — es haelt die Herkunft des Voll-Pulls auf einem Quote-Wert fest');
});

// (2) Der Stempel: die Schreibstelle fuehrt value UND asOf. Geprueft wird die Stelle selbst,
// weil _priceOnlyUpdate in der Closure von pullAll steckt und von aussen nicht aufrufbar ist.
// Der Anker ist die Zuweisung an den Wert — steht danach kein asOf, faellt der Test.
check('Schnellpfad: wer marketCap.value schreibt, schreibt marketCap.asOf', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const i = src.indexOf('existing.marketCap.value = q.marketCap * tradingAggFactor;');
  assert.ok(i > 0, 'die Schreibstelle des Schnellpfads existiert noch — sonst ist dieser Test blind');
  const danach = src.slice(i, i + 800);
  assert.ok(/existing\.marketCap\.asOf\s*=/.test(danach),
    'marketCap.value wird geschrieben, marketCap.asOf nicht — genau der luegende Stempel vom 19.09.');
  assert.ok(src.indexOf('existing.marketCap.value = q.marketCap * tradingAggFactor;', i + 1) === -1,
    'mehr als eine Schreibstelle: der Anker ist mehrdeutig geworden, Test nachziehen');
});

console.log('\nmanifest-teilmenge: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
