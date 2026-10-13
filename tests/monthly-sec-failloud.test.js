'use strict';
/**
 * Waechter: der Monats-SEC-Lauf darf nicht mehr still gruen sein.
 *
 * DER BEFUND (28.07.): external-data/sec-secannual.json wurde seit Bestehen des Workflows
 * NIE von einem Bot-Lauf geaendert. Alle drei Aenderungen stammen von Hand
 * (03.07. / 10.07. / 21.07., git log belegt). Die Bot-Laeufe meldeten trotzdem gruen.
 *
 * Die Kette, Glied fuer Glied nachgeprueft:
 *   1. daily-pull laeuft Di-Sa (cron '17 2 * * 2-6')
 *   2. sein snapshots-Artefakt lebt EINEN Tag (retention-days: 1)
 *   3. dieser Workflow startet am 1. jedes Monats (cron '0 8 1 * *'), egal welcher Wochentag
 *   4. faellt der Erste auf Sonntag oder Montag, ist das Artefakt schon geloescht
 *   5. `find_run` prueft nur, ob ein LAUF existierte — nicht, ob sein Artefakt noch da ist
 *   6. der Download scheitert unter continue-on-error, snapshots/ bleibt leer
 *   7. build-secannual.js macht einen "lauten No-Op" als ::warning:: und endet mit 0
 * Ein ::warning:: ist kein rotes X — also ausserhalb des einzigen Alarmkanals, den Karl liest.
 *
 * Dieser Waechter nagelt die Heilung fest. Er prueft die WORKFLOW-DATEI, weil sich der
 * Fehler nur dort zeigt und ein Testlauf ihn nicht reproduzieren kann.
 *
 * Usage:  node tests/monthly-sec-failloud.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Zeilenenden vereinheitlichen: git materialisiert die Dateien unter Windows mit CRLF —
// ohne das finden die Block-Suchen unten nichts (Falschalarm nur lokal, CI bleibt gruen).
const WF = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'monthly-sec-xbrl.yml'), 'utf8')
  .split('\r\n').join('\n');
const DAILY = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8')
  .split('\r\n').join('\n');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

check('ein leerer Snapshot-Restore macht den Lauf ROT, nicht gruen', () => {
  assert.ok(/Verify snapshots restored \(fail-loud\)/.test(WF), 'Pruefschritt fehlt');
  assert.ok(/::error::snapshots-Restore fehlgeschlagen/.test(WF), 'muss ::error:: sein, nicht ::warning::');
  assert.ok(/exit 1/.test(WF), 'muss mit exit 1 enden');
});

check('der Pruefschritt laeuft OHNE if-Bedingung', () => {
  // Sonst waere er selbst uebersprungen, wenn gar kein Lauf gefunden wurde — genau der
  // Fall, den er fangen soll. Geprueft wird der Block ZWISCHEN Schritt-Name und dem
  // naechsten `- name:`.
  const i = WF.indexOf('- name: Verify snapshots restored');
  assert.ok(i > 0);
  const bis = WF.indexOf('- name:', i + 10);
  const block = WF.slice(i, bis > 0 ? bis : undefined);
  assert.ok(!/^\s+if:/m.test(block), 'der Pruefschritt darf keine if-Bedingung tragen');
});

check('die Untergrenze ist gesetzt und nicht bei null', () => {
  const m = WF.match(/if \[ "\$N" -lt (\d+) \]/);
  assert.ok(m, 'Untergrenze fehlt');
  const n = Number(m[1]);
  assert.ok(n >= 100, 'eine Untergrenze von ' + n + ' faengt einen Teil-Restore nicht');
});

check('die Ursache steht im Workflow, nicht nur im Commit', () => {
  // Wer den Schritt in zwei Jahren sieht, muss ohne git-Archaeologie verstehen, warum.
  assert.ok(/Artefakt-Lebensdauer|retention-days/.test(WF), 'die Artefakt-Lebensdauer muss benannt sein');
  assert.ok(/Sonntag oder Montag/.test(WF), 'der konkrete Ausfall-Fall muss benannt sein');
});

/**
 * Liest retention-days GENAU des benannten Artefakts, nicht irgendeines in der Datei.
 *
 * ⚠ Das ist die Heilung eines Fehlers in diesem Test selbst (28.07.): die alte Fassung
 * pruefte `/retention-days: 1/` gegen die GANZE Datei. daily-pull.yml laedt aber ZWEI
 * Artefakte hoch — das Shard-Paket (Lebensdauer 1 Tag, wird im selben Lauf verbraucht)
 * und das snapshots-Paket (das der Monatslauf holt). Als die Lebensdauer des zweiten auf
 * 7 gesetzt wurde, blieb der Test GRUEN, weil das erste weiter "1" trug. Ein Waechter,
 * der ein Schreibmuster irgendwo in einer Datei sucht statt die Sache am richtigen Ort,
 * ist kein Waechter.
 */
function retentionVon(yaml, artefaktName) {
  const i = yaml.indexOf('name: ' + artefaktName + '\n');
  assert.ok(i > 0, 'Artefakt "' + artefaktName + '" nicht gefunden');
  const bis = yaml.indexOf('- name:', i);
  const block = yaml.slice(i, bis > 0 ? bis : i + 2000);
  const m = block.match(/retention-days:\s*(\d+)/);
  assert.ok(m, 'retention-days fehlt beim Artefakt "' + artefaktName + '"');
  return Number(m[1]);
}

check('das snapshots-Paket ueberlebt das Wochenende', () => {
  // Der Monatslauf startet am 1., egal welcher Wochentag; daily-pull laeuft Di-Sa.
  // Faellt der Erste auf Sonntag oder Montag, braucht das Paket mindestens 3 Tage
  // Haltbarkeit — sonst ist es weg und der Monatslauf wird durch den fail-loud-Schritt
  // ROT, mit einem Alarm, den Karl nicht reparieren kann.
  const tage = retentionVon(DAILY, 'snapshots');
  assert.ok(tage >= 3, 'snapshots lebt nur ' + tage + ' Tag(e) — ein Erster am Sonntag/Montag findet nichts');
});

check('die Praemisse stimmt noch: daily-pull laeuft Di-Sa, der Monatslauf am Ersten', () => {
  // Faellt eine der beiden, ist die Begruendung oben veraltet — dann soll dieser Test
  // rot werden und zum Nachlesen zwingen, statt eine falsche Erklaerung zu konservieren.
  assert.ok(/cron: '17 2 \* \* 2-6'/.test(DAILY), 'der daily-pull-Zeitplan hat sich geaendert');
  assert.ok(/cron: '0 8 1 \* \*'/.test(WF), 'der Monats-Zeitplan hat sich geaendert');
});

console.log('\nmonthly-sec-failloud: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
